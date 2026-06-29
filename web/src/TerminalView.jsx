import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ClientMsg, ServerMsg } from './ws.js';

// Renders the real terminal (the claude TUI / installer / login output) with
// xterm.js and bridges keystrokes + resize over the WebSocket. We render the
// true terminal rather than parsing the TUI into custom chat bubbles.
export default function TerminalView({ ws }) {
  const ref = useRef(null);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Cascadia Code", "Courier New", monospace',
      fontSize: 13,
      scrollback: 8000,
      convertEol: false,
      theme: {
        background: '#0b0f14',
        foreground: '#d6deeb',
        cursor: '#7dd3fc',
        selectionBackground: '#1f3a5f',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    try { fit.fit(); } catch {}

    const sendInput = (d) => ws.send({ type: ClientMsg.PTY_INPUT, data: d });
    const dataSub = term.onData(sendInput);

    const sendResize = () => {
      try { fit.fit(); } catch {}
      if (term.cols && term.rows) {
        ws.send({ type: ClientMsg.PTY_RESIZE, cols: term.cols, rows: term.rows });
      }
    };

    const ro = new ResizeObserver(() => sendResize());
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', sendResize);

    const off = ws.on((m) => {
      if (m.type === ServerMsg.PTY_OUTPUT) { term.write(m.data); return; }
      // On (re)connect, clear the local terminal BEFORE the server replays its
      // output buffer — otherwise a transient reconnect (sleep/wake, network blip)
      // re-appends the existing scrollback onto this persistent xterm and
      // duplicates/garbles it. '_open' is emitted synchronously when the socket
      // opens, before any replayed PTY_OUTPUT can round-trip back.
      if (m.type === '_open') { term.reset(); sendResize(); }
      // A freshly launched session PTY needs the real dimensions (not 80x24).
      else if (m.type === ServerMsg.SESSION_READY) sendResize();
    });

    // initial size sync after first paint
    const t = setTimeout(sendResize, 60);
    term.focus();

    return () => {
      clearTimeout(t);
      off();
      dataSub.dispose();
      ro.disconnect();
      window.removeEventListener('resize', sendResize);
      term.dispose();
    };
  }, [ws]);

  return <div className="terminal" ref={ref} />;
}
