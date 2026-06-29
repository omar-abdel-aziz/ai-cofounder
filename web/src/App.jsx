import { useEffect, useRef, useState } from 'react';
import { getWs, ClientMsg, ServerMsg } from './ws.js';
import TerminalView from './TerminalView.jsx';
import SetupWizard from './SetupWizard.jsx';
import SkillLauncher from './SkillLauncher.jsx';
import ComposeBox from './ComposeBox.jsx';

// The terminal stays mounted across the wizard -> session transition so its
// scrollback (install / login output) is preserved. Only the left control panel
// swaps between the setup wizard and the skill launcher.
export default function App() {
  const wsRef = useRef(null);
  if (!wsRef.current) wsRef.current = getWs();
  const ws = wsRef.current;

  const [connected, setConnected] = useState(false);
  const [detect, setDetect] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [loginUrl, setLoginUrl] = useState(null);
  const [skillsList, setSkillsList] = useState([]);
  const [launched, setLaunched] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    const off = ws.on((m) => {
      switch (m.type) {
        case '_open':
          setConnected(true);
          ws.send({ type: ClientMsg.DETECT });
          break;
        case '_close':
          setConnected(false);
          break;
        case ServerMsg.DETECT_RESULT: {
          // strip the wire 'type' so it doesn't leak into the snapshot
          const { type, ...snapshot } = m;
          setDetect(snapshot);
          break;
        }
        case ServerMsg.STATUS:
          setStatuses((s) => ({ ...s, [m.step]: { state: m.state, detail: m.detail } }));
          break;
        case ServerMsg.LOGIN_URL:
          setLoginUrl(m.url);
          break;
        case ServerMsg.SKILLS_LIST:
          setSkillsList(m.skills || []);
          break;
        case ServerMsg.SESSION_READY:
          setLaunched(true);
          break;
        case ServerMsg.ERROR:
          setErrorMsg(m.message);
          break;
        default:
          break;
      }
    });

    // If the socket opened before this listener attached, kick off detection now.
    if (ws.connected) {
      setConnected(true);
      ws.send({ type: ClientMsg.DETECT });
    }
    return off;
  }, [ws]);

  function act(type) {
    setErrorMsg(null);
    if (type === ClientMsg.LOGIN) setLoginUrl(null);
    ws.send({ type });
  }

  const canLaunch = !!(detect && detect.claudeInstalled && detect.loggedIn && detect.skillsInstalled);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🚀 AI Co-Founder <span className="tag">localhost</span></div>
        <div className="top-right">
          {launched && (
            <button className="btn ghost" onClick={() => setLaunched(false)}>← Setup</button>
          )}
          <span className={'conn ' + (connected ? 'on' : 'off')}>
            {connected ? 'connected' : 'reconnecting…'}
          </span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          {launched
            ? <SkillLauncher ws={ws} skills={skillsList} />
            : <SetupWizard detect={detect} statuses={statuses} loginUrl={loginUrl} act={act} canLaunch={canLaunch} />}
        </aside>

        <main className="terminal-pane">
          <div className="terminal-bar">
            {launched ? (
              <>
                <span className="claude-badge">✦</span>
                <span className="terminal-title">Claude — your co-founder</span>
                <span className="live-dot" title="live session" />
              </>
            ) : (
              <>
                <span className="dot red" /><span className="dot yellow" /><span className="dot green" />
                <span className="terminal-title">setup output</span>
              </>
            )}
          </div>
          <TerminalView ws={ws} />
          {launched && <ComposeBox ws={ws} />}
        </main>
      </div>

      {errorMsg && (
        <div className="toast error" role="alert" onClick={() => setErrorMsg(null)}>
          {errorMsg}<span className="toast-x">×</span>
        </div>
      )}
    </div>
  );
}
