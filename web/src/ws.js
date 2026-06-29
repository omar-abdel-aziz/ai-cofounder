// Browser WebSocket client: a singleton with auto-reconnect and a tiny pub/sub.
// The message-type constants mirror server/ws-protocol.js — keep them in sync.

export const ClientMsg = {
  ATTACH: 'attach',
  DETECT: 'detect',
  INSTALL: 'install',
  INSTALL_SKILLS: 'installSkills',
  LOGIN: 'login',
  SESSION_LAUNCH: 'session.launch',
  PTY_INPUT: 'pty.input',
  PTY_RESIZE: 'pty.resize',
};

export const ServerMsg = {
  ATTACHED: 'attached',
  DETECT_RESULT: 'detect.result',
  STATUS: 'status',
  PTY_OUTPUT: 'pty.output',
  LOGIN_URL: 'login.url',
  SESSION_READY: 'session.ready',
  SKILLS_LIST: 'skills.list',
  ERROR: 'error',
};

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

class WsClient {
  constructor() {
    this.listeners = new Set();
    this.queue = [];
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
    // sessionStorage (NOT localStorage): survives a same-tab reload so we
    // reconnect to our live PTY, but is isolated per tab so a second tab gets a
    // fresh session instead of stealing this tab's stream.
    try { this.sessionId = sessionStorage.getItem('cofounder.sessionId') || null; } catch {}
    this._connect();
  }

  _connect() {
    let ws;
    try { ws = new WebSocket(wsUrl()); } catch { setTimeout(() => this._connect(), 1000); return; }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      // (Re)bind to our session so a reconnect re-attaches to the live PTY.
      ws.send(JSON.stringify({ type: ClientMsg.ATTACH, sessionId: this.sessionId }));
      for (const m of this.queue.splice(0)) {
        try { ws.send(JSON.stringify(m)); } catch {}
      }
      this._emit({ type: '_open' });
    };

    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === ServerMsg.ATTACHED && m.sessionId) {
        this.sessionId = m.sessionId;
        try { sessionStorage.setItem('cofounder.sessionId', m.sessionId); } catch {}
      }
      this._emit(m);
    };

    ws.onclose = () => {
      this.connected = false;
      this._emit({ type: '_close' });
      setTimeout(() => this._connect(), 1000);
    };

    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(obj)); return; } catch {}
    }
    this.queue.push(obj);
  }

  on(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  _emit(m) { for (const cb of this.listeners) { try { cb(m); } catch {} } }
}

let _client = null;
export function getWs() {
  if (!_client) _client = new WsClient();
  return _client;
}
