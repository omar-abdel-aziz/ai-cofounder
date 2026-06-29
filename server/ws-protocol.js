// Single source of truth for the WebSocket wire protocol (server side).
// The browser keeps a mirror of these string constants in web/src/ws.js —
// if you change a value here, change it there too.

const ClientMsg = {
  ATTACH: 'attach',                 // { sessionId } — bind this socket to a (re)connecting session
  DETECT: 'detect',                 // run environment detection
  INSTALL: 'install',               // install Claude Code (native installer)
  INSTALL_SKILLS: 'installSkills',  // copy bundled skills into ~/.claude/skills
  LOGIN: 'login',                   // start interactive OAuth login
  SESSION_LAUNCH: 'session.launch', // start the main interactive claude session
  PTY_INPUT: 'pty.input',           // { data } keystrokes to the attached PTY
  PTY_RESIZE: 'pty.resize',         // { cols, rows } resize the attached PTY
};

const ServerMsg = {
  ATTACHED: 'attached',             // { sessionId } — confirms/assigns the session id
  DETECT_RESULT: 'detect.result',   // environment snapshot (see detect.js)
  STATUS: 'status',                 // { step, state, detail }
  PTY_OUTPUT: 'pty.output',         // { data } raw terminal bytes to render
  LOGIN_URL: 'login.url',           // { url } OAuth URL fallback link
  SESSION_READY: 'session.ready',   // main session is live
  SKILLS_LIST: 'skills.list',       // { skills: [{ name, folder, description }] }
  ERROR: 'error',                   // { message }
};

// Wizard steps and their states (carried on `status` messages).
const Step = { DETECT: 'detect', INSTALL: 'install', SKILLS: 'skills', LOGIN: 'login', SESSION: 'session' };
const State = { RUNNING: 'running', OK: 'ok', ERROR: 'error', NEEDS_ACTION: 'needs-action' };

function serialize(obj) { return JSON.stringify(obj); }
function deserialize(raw) { try { return JSON.parse(raw.toString()); } catch { return null; } }

module.exports = { ClientMsg, ServerMsg, Step, State, serialize, deserialize };
