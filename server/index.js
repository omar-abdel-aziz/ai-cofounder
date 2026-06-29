// AI Co-Founder — localhost server.
// Serves the built web UI (production) and a WebSocket that drives the setup
// wizard + the interactive `claude` session over PTYs. Binds to 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { WebSocketServer } = require('ws');

const { ClientMsg, ServerMsg, Step, State, serialize, deserialize } = require('./ws-protocol');

// node-pty may fail to load if there's no prebuilt binary and no local toolchain.
// Detect that and keep the server alive (detect/skills still work; PTY actions
// return a clear error telling the user to install build tools).
let ptyLib = null;
let ptyLoadError = null;
try {
  ptyLib = require('./pty-manager');
} catch (e) {
  ptyLoadError = e;
  console.warn('[ai-cofounder] node-pty failed to load:', e.message);
}

const detect = require('./setup/detect');
const install = require('./setup/install');
const skills = require('./setup/skills');
const login = require('./setup/login');
const paths = require('./setup/paths');
const trust = require('./setup/trust');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist');
const WORKSPACES = path.join(ROOT, 'workspaces');

try { fs.mkdirSync(WORKSPACES, { recursive: true }); } catch {}

// ---------------------------------------------------------------------------
// Static file serving (production: serves web/dist; dev: Vite serves the UI).
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function devHint() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>AI Co-Founder</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem;max-width:42rem;margin:auto;line-height:1.6">
  <h1>🚀 AI Co-Founder</h1>
  <p>No production build was found in <code>web/dist</code>.</p>
  <ul>
    <li><b>Development:</b> run <code>npm run dev</code>, then open
        <a href="http://localhost:5173">http://localhost:5173</a></li>
    <li><b>Production:</b> run <code>npm run build</code>, then <code>npm start</code>,
        then open <a href="http://localhost:${PORT}">http://localhost:${PORT}</a></li>
  </ul>
</body></html>`;
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(url.parse(req.url).pathname || '/'); }
  catch { pathname = '/'; }
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(DIST, pathname));
  // Anchor the boundary to a path separator so siblings like web/dist-evil/ can't
  // satisfy a bare startsWith(DIST) prefix check.
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // No build yet -> friendly hint. Otherwise SPA fallback to index.html.
      const indexPath = path.join(DIST, 'index.html');
      if (!fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(devHint());
      }
      return fs.readFile(indexPath, (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

// ---------------------------------------------------------------------------
// WebSocket: one connection per browser tab. Sessions are keyed by a client
// sessionId so a dropped/reconnected socket re-attaches to the live PTY.
// ---------------------------------------------------------------------------
const sessions = new Map(); // sessionId -> { id, bridge, reaper }
const REAP_GRACE_MS = 60 * 1000; // keep an orphaned session this long for reconnect

function genId() {
  return 'sess-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Reject cross-site WebSocket hijacking: without this, any web page the user
// visits could open ws://127.0.0.1:<port>/ws and drive the interactive claude
// PTY. Browsers always send Origin on WS handshakes, so we allowlist our own
// origins and additionally require a loopback Host (blunts DNS-rebinding).
// Non-browser clients send no Origin and are permitted only over a loopback Host.
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
  'http://localhost:5173', 'http://127.0.0.1:5173',
]);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ origin, req }) => {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return false;
    const host = String(req.headers.host || '').split(':')[0];
    return host === 'localhost' || host === '127.0.0.1';
  },
});

wss.on('connection', (ws) => {
  let session = null;

  // Reconnect-safe send: route through the bridge (which holds the *current*
  // bound socket) when a session/bridge exists; fall back to this socket.
  function reply(obj) {
    if (session && session.bridge) session.bridge.send(obj);
    else if (ws.readyState === 1) { try { ws.send(serialize(obj)); } catch {} }
  }

  function ensureSession(sessionId) {
    // Only accept a client id matching our generated shape: it becomes a
    // workspace directory name (so this blocks path traversal) and limits
    // reconnect to ids we actually minted.
    let id = (typeof sessionId === 'string' && /^sess-[a-z0-9]+$/.test(sessionId)) ? sessionId : null;
    // Collision guard: if another live socket already owns this session (e.g. a
    // duplicated tab sharing the token), don't steal its stream — mint a fresh one.
    if (id && sessions.has(id)) {
      const ex = sessions.get(id);
      if (ex.bridge && ex.bridge.ws && ex.bridge.ws !== ws && ex.bridge.ws.readyState === 1) id = null;
    }
    if (!id || !sessions.has(id)) {
      id = id || genId();
      if (!sessions.has(id)) sessions.set(id, { id, bridge: ptyLib ? new ptyLib.Bridge() : null, reaper: null });
    }
    session = sessions.get(id);
    if (session.reaper) { clearTimeout(session.reaper); session.reaper = null; }
    if (session.bridge) session.bridge.bindSocket(ws);
    if (ws.readyState === 1) ws.send(serialize({ type: ServerMsg.ATTACHED, sessionId: id }));
    // If a live claude session is already running (reconnect/reload), restore the
    // session view instead of dropping the user back onto the setup wizard.
    if (session.bridge && session.bridge.isLiveSession() && ws.readyState === 1) {
      ws.send(serialize({ type: ServerMsg.SESSION_READY }));
    }
    return session;
  }

  function requirePty() {
    if (!ptyLib) {
      reply({
        type: ServerMsg.ERROR,
        message: 'node-pty could not load on this machine — install build tools (see README) and run "npm install" again.'
          + (ptyLoadError ? ' Details: ' + ptyLoadError.message : ''),
      });
      return false;
    }
    return true;
  }

  // Push a fresh environment snapshot + skills list (used after each mutation
  // so the wizard's gates update without the client re-asking).
  async function pushEnv() {
    const result = await detect.detect();
    reply({ type: ServerMsg.DETECT_RESULT, ...result });
    reply({ type: ServerMsg.SKILLS_LIST, skills: skills.listSkills() });
    return result;
  }

  async function handleDetect() {
    reply({ type: ServerMsg.STATUS, step: Step.DETECT, state: State.RUNNING });
    const result = await pushEnv();
    reply({ type: ServerMsg.STATUS, step: Step.DETECT, state: State.OK, detail: result.detail });
  }

  async function handleInstall() {
    if (!requirePty()) return;
    const cur = await detect.detect();
    if (cur.claudeInstalled) {
      reply({ type: ServerMsg.STATUS, step: Step.INSTALL, state: State.OK, detail: `Already installed (${cur.claudeVersion}).` });
      await pushEnv();
      return;
    }
    reply({ type: ServerMsg.STATUS, step: Step.INSTALL, state: State.RUNNING, detail: 'Downloading and running the official installer…' });
    await install.runInstall({ spawn: ptyLib.spawnPty, bridge: session.bridge, send: reply });
    await pushEnv();
  }

  async function handleSkills() {
    reply({ type: ServerMsg.STATUS, step: Step.SKILLS, state: State.RUNNING });
    const r = skills.installSkills();
    const ok = r.installed.length > 0;
    const detail = ok
      ? `Installed ${r.installed.length} skill(s) → ${r.destRoot}` + (r.errors.length ? `. Issues: ${r.errors.join('; ')}` : '')
      : `No skills installed. ${r.errors.join('; ')}`;
    reply({ type: ServerMsg.STATUS, step: Step.SKILLS, state: ok ? State.OK : State.ERROR, detail });
    await pushEnv();
  }

  async function handleLogin() {
    if (!requirePty()) return;
    const cur = await detect.detect();
    if (!cur.claudeInstalled) { reply({ type: ServerMsg.ERROR, message: 'Install Claude Code first.' }); return; }
    if (cur.loggedIn) {
      reply({
        type: ServerMsg.STATUS, step: Step.LOGIN, state: State.OK,
        detail: cur.account && cur.account.email ? `Already signed in as ${cur.account.email}.` : 'Already signed in.',
      });
      await pushEnv(); // refresh the snapshot so detect.loggedIn flips and Launch unlocks
      return;
    }
    login.startLogin({
      spawn: ptyLib.spawnPty,
      bridge: session.bridge,
      claudePath: cur.claudePath,
      send: reply,
      onDone: () => pushEnv(),
    });
  }

  async function handleLaunch() {
    if (!requirePty()) return;
    // If a live claude session already exists (double-click / reconnect), just
    // re-advertise it — never kill the running PTY and lose in-progress work.
    if (session.bridge && session.bridge.isLiveSession()) {
      reply({ type: ServerMsg.STATUS, step: Step.SESSION, state: State.OK });
      reply({ type: ServerMsg.SESSION_READY });
      return;
    }
    const cur = await detect.detect();
    if (!cur.claudeInstalled) { reply({ type: ServerMsg.ERROR, message: 'Claude Code is not installed yet.' }); return; }
    const wsDir = path.join(WORKSPACES, session.id);
    // Defense in depth (session.id is already shape-validated): never let the
    // workspace escape WORKSPACES.
    if (wsDir !== WORKSPACES && !wsDir.startsWith(WORKSPACES + path.sep)) {
      reply({ type: ServerMsg.ERROR, message: 'Invalid session workspace.' });
      return;
    }
    try { fs.mkdirSync(wsDir, { recursive: true }); } catch {}
    // Pre-accept the per-folder trust dialog for this workspace we just created,
    // so non-technical users land straight on the prompt instead of a scary
    // "do you trust this folder?" screen. Best-effort; dialog still shows if it fails.
    trust.pretrustWorkspace(wsDir);
    const bin = cur.claudePath || (paths.isWin ? 'claude.exe' : 'claude');
    reply({ type: ServerMsg.STATUS, step: Step.SESSION, state: State.RUNNING, detail: 'Starting your Claude session…' });
    // Interactive claude in its own workspace. Permission prompts + first-run
    // onboarding/trust dialogs render in the terminal for the user to approve.
    const p = ptyLib.spawnPty(bin, [], wsDir);
    session.bridge.attach(p, 'session');
    reply({ type: ServerMsg.STATUS, step: Step.SESSION, state: State.OK });
    reply({ type: ServerMsg.SESSION_READY });
  }

  ws.on('message', async (raw) => {
    const m = deserialize(raw);
    if (!m || !m.type) return;

    if (m.type === ClientMsg.ATTACH) { ensureSession(m.sessionId); return; }
    if (!session) ensureSession(m.sessionId);

    try {
      switch (m.type) {
        case ClientMsg.DETECT:          return void (await handleDetect());
        case ClientMsg.INSTALL:         return void (await handleInstall());
        case ClientMsg.INSTALL_SKILLS:  return void (await handleSkills());
        case ClientMsg.LOGIN:           return void (await handleLogin());
        case ClientMsg.SESSION_LAUNCH:  return void (await handleLaunch());
        case ClientMsg.PTY_INPUT:       return void (session.bridge && session.bridge.write(m.data));
        case ClientMsg.PTY_RESIZE:      return void (session.bridge && session.bridge.resize(m.cols, m.rows));
        default: return;
      }
    } catch (e) {
      reply({ type: ServerMsg.ERROR, message: String((e && e.message) || e) });
    }
  });

  ws.on('error', () => {});
  // On close, keep the session + PTY alive briefly so a reconnect (same sessionId)
  // can re-attach to the running claude session. If nobody re-attaches within the
  // grace window, reap it so orphaned claude PTYs don't accumulate.
  ws.on('close', () => {
    if (!session) return;
    const closed = ws;
    const s = session;
    if (s.reaper) clearTimeout(s.reaper);
    s.reaper = setTimeout(() => {
      const stillGone = !s.bridge || !s.bridge.ws || s.bridge.ws === closed || s.bridge.ws.readyState !== 1;
      if (stillGone) {
        if (s.bridge) { try { s.bridge.killCurrent(); } catch {} }
        sessions.delete(s.id);
      }
    }, REAP_GRACE_MS);
  });
});

// ---------------------------------------------------------------------------
function openBrowser(target) {
  const { spawn } = require('child_process');
  let cmd, args;
  if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', target]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [target]; }
  else { cmd = 'xdg-open'; args = [target]; }
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}

server.listen(PORT, HOST, () => {
  const target = `http://localhost:${PORT}`;
  console.log(`\n  🚀 AI Co-Founder server running at ${target}`);
  if (!ptyLib) console.log('  ⚠  node-pty is unavailable — terminal features are disabled until build tools are installed.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.log('  ℹ  No production build yet. Use `npm run dev` (opens http://localhost:5173) or `npm run build` then `npm start`.');
  }
  if (process.argv.includes('--open') && fs.existsSync(path.join(DIST, 'index.html'))) {
    openBrowser(target);
  }
});

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use. Set PORT=<other> and retry (e.g. PORT=3100 npm start).`);
    process.exit(1);
  }
  throw e;
});
