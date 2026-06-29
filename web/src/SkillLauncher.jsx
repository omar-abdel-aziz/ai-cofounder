import { ClientMsg } from './ws.js';

// Buttons that inject "/skill-name" + Enter into the live claude session.
export default function SkillLauncher({ ws, skills }) {
  const list = (skills && skills.length)
    ? skills
    : [{ name: 'cofounder-idea-validation', description: 'Pressure-test a startup idea and propose the cheapest experiment to de-risk it.' }];

  function run(name) {
    // \r mimics the Enter key in a terminal (TUIs read CR, not LF).
    ws.send({ type: ClientMsg.PTY_INPUT, data: `/${name}\r` });
  }

  return (
    <div className="launcher">
      <div className="wizard-head">
        <h1>Your AI Co-Founder is live</h1>
        <p className="muted">Click a skill to run it, or just type to your co-founder in the terminal →</p>
      </div>

      <h3 className="section">Skills</h3>
      <div className="skill-list">
        {list.map((s) => (
          <button key={s.name} className="skill-btn" onClick={() => run(s.name)} title={s.description}>
            <span className="skill-name">/{s.name}</span>
            {s.description && <span className="skill-desc">{s.description}</span>}
          </button>
        ))}
      </div>

      <div className="hint">
        Tip: type in the message box, or click a skill above. If Claude ever shows a
        choice or permission prompt, answer it with the quick-key buttons
        (Yes / No / Enter / arrows) below the terminal — no need to click into it.
      </div>
    </div>
  );
}
