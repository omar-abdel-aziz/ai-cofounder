// Spawns PTYs and bridges their byte stream to a WebSocket. node-pty is required
// at the top: if its native addon is missing (no prebuild + no toolchain) this
// require throws, and server/index.js catches it to degrade gracefully.
// Self-heal node-pty's spawn-helper exec bit BEFORE requiring node-pty resolves
// its helper path (prevents "posix_spawnp failed" on macOS/Linux prebuilds).
try { require('../scripts/fix-spawn-helper').ensureSpawnHelperExecutable(); } catch {}

const pty = require('node-pty');
const os = require('os');
const { withBinOnPath, isWin } = require('./setup/paths');
const { ServerMsg, serialize } = require('./ws-protocol');

function defaultShell() {
  if (isWin) return process.env.ComSpec || 'powershell.exe';
  return process.env.SHELL || 'bash';
}

// Spawn a PTY for `file args` in `cwd`, with our install bin dir on PATH.
function spawnPty(file, args = [], cwd) {
  return pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd || os.homedir(),
    env: withBinOnPath(process.env),
  });
}

// A Bridge owns the "currently attached" PTY for one logical session and forwards
// its bytes to whatever socket is currently bound. The bound socket can change
// (WebSocket reconnect) without disturbing the live PTY.
const OUTPUT_BUFFER_CAP = 256 * 1024; // ~256KB rolling buffer, replayed on (re)connect

class Bridge {
  constructor() {
    this.ws = null;
    this.current = null;
    this.currentKind = null;
    this._dataSub = null;
    this._exitSub = null;
    this._buf = '';        // recent PTY output, for replay after reconnect/reload
    this._lastCols = 0;    // last requested terminal size (re-applied to new PTYs)
    this._lastRows = 0;
  }

  bindSocket(ws) {
    this.ws = ws;
    // Replay recent output so a reconnected/reloaded terminal regains context and
    // doesn't lose bytes the live PTY emitted while the socket was down.
    if (ws && ws.readyState === 1 && this._buf) {
      try { ws.send(serialize({ type: ServerMsg.PTY_OUTPUT, data: this._buf })); } catch {}
    }
  }

  send(obj) {
    if (obj && obj.type === ServerMsg.PTY_OUTPUT && typeof obj.data === 'string') {
      this._buf = (this._buf + obj.data).slice(-OUTPUT_BUFFER_CAP);
    }
    const ws = this.ws;
    if (ws && ws.readyState === 1) { try { ws.send(serialize(obj)); } catch {} }
  }

  // Attach a new PTY as the current one. Any previously attached PTY is killed.
  attach(ptyProc, kind) {
    this.killCurrent();
    this.current = ptyProc;
    this.currentKind = kind;
    this._buf = ''; // fresh PTY -> fresh scrollback
    this._dataSub = ptyProc.onData((d) => this.send({ type: ServerMsg.PTY_OUTPUT, data: d }));
    this._exitSub = ptyProc.onExit(() => {
      if (this._dataSub) { try { this._dataSub.dispose(); } catch {} this._dataSub = null; }
      // Clear live-PTY state so reconnect logic never restores a dead session.
      this.current = null;
      this.currentKind = null;
    });
    // Re-apply the last known size so a freshly spawned PTY isn't stuck at 80x24.
    if (this._lastCols && this._lastRows) {
      try { ptyProc.resize(this._lastCols, this._lastRows); } catch {}
    }
    return ptyProc;
  }

  write(data) { if (this.current) { try { this.current.write(data); } catch {} } }

  resize(cols, rows) {
    const c = Math.max(cols | 0, 1);
    const r = Math.max(rows | 0, 1);
    this._lastCols = c;
    this._lastRows = r;
    if (this.current) { try { this.current.resize(c, r); } catch {} }
  }

  // Is an interactive claude session currently live? (used to restore the view
  // on reconnect and to avoid killing it on a redundant launch)
  isLiveSession() { return this.currentKind === 'session' && !!this.current; }

  killCurrent() {
    if (this._dataSub) { try { this._dataSub.dispose(); } catch {} this._dataSub = null; }
    if (this._exitSub) { try { this._exitSub.dispose(); } catch {} this._exitSub = null; }
    if (this.current) { try { this.current.kill(); } catch {} this.current = null; this.currentKind = null; }
  }
}

module.exports = { spawnPty, defaultShell, Bridge };
