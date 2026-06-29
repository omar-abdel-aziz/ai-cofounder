import { useRef, useState } from 'react';
import { ClientMsg } from './ws.js';

// Friendly chat-style input. You type here (and SEE what you type), and on send
// it's injected into the live claude PTY as if typed + Enter. The quick-key row
// lets you answer Claude's menu prompts (permissions, choices) without needing to
// click into the terminal.
const QUICK_KEYS = [
  { label: '↵ Enter', data: '\r', title: 'Confirm / submit the highlighted choice' },
  { label: 'Esc', data: '\x1b', title: 'Cancel / go back' },
  { label: '↑', data: '\x1b[A', title: 'Move up in a menu' },
  { label: '↓', data: '\x1b[B', title: 'Move down in a menu' },
  { label: 'Yes', data: 'y', title: 'Answer yes' },
  { label: 'No', data: 'n', title: 'Answer no' },
];

export default function ComposeBox({ ws }) {
  const [text, setText] = useState('');
  const taRef = useRef(null);

  function refocus() {
    requestAnimationFrame(() => { if (taRef.current) taRef.current.focus(); });
  }

  function send() {
    if (!text.trim()) return;
    ws.send({ type: ClientMsg.PTY_INPUT, data: text + '\r' });
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
    refocus();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
    // Shift+Enter falls through to the textarea's default newline.
  }

  function onChange(e) {
    setText(e.target.value);
    // auto-grow up to the CSS max-height
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
  }

  function sendKey(data) {
    ws.send({ type: ClientMsg.PTY_INPUT, data });
    refocus();
  }

  return (
    <div className="compose">
      <div className="compose-keys">
        <span className="compose-keys-label">Answer a prompt:</span>
        {QUICK_KEYS.map((k) => (
          <button key={k.label} className="keycap" title={k.title} onClick={() => sendKey(k.data)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="compose-row">
        <textarea
          ref={taRef}
          className="compose-input"
          rows={1}
          value={text}
          placeholder="Message your co-founder…   (Enter to send · Shift+Enter for a new line)"
          onChange={onChange}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <button className="btn primary compose-send" onClick={send} disabled={!text.trim()}>Send ↵</button>
      </div>
    </div>
  );
}
