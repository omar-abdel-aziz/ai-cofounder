import { ClientMsg } from './ws.js';

// Linear, resumable setup. Each step shows a status chip + an action button and
// streams its output into the terminal on the right. "Launch" is gated until
// Claude Code is installed, logged in, and the skills are installed. (We treat
// on-PATH as informational, not a hard gate — the app launches claude via its
// explicit path with the bin dir prepended to the child env, so it works even
// before a global PATH refresh.)

const STEPS = [
  { key: 'detect',  num: 1, title: 'Check your computer',   desc: 'See what is already set up.',                 action: ClientMsg.DETECT,         label: 'Re-check' },
  { key: 'install', num: 2, title: 'Install Claude Code',   desc: 'Downloads the official app if it is missing.', action: ClientMsg.INSTALL,        label: 'Install' },
  { key: 'skills',  num: 3, title: 'Add co-founder skills', desc: 'Loads the business-coaching skills.',          action: ClientMsg.INSTALL_SKILLS, label: 'Add skills' },
  { key: 'login',   num: 4, title: 'Sign in to Claude',     desc: 'Opens your browser to log in (OAuth).',        action: ClientMsg.LOGIN,          label: 'Sign in' },
];

const CHIP_LABEL = {
  idle: 'To do', running: 'Working…', ok: 'Done', error: 'Failed', 'needs-action': 'Action needed',
};

function isDone(key, detect) {
  if (!detect) return false;
  if (key === 'detect') return true;
  if (key === 'install') return !!detect.claudeInstalled;
  if (key === 'skills') return !!detect.skillsInstalled;
  if (key === 'login') return !!detect.loggedIn;
  return false;
}

function stepState(key, detect, statuses) {
  const s = statuses[key] && statuses[key].state;
  if (s === 'running') return 'running';
  if (isDone(key, detect)) return 'ok';
  if (s === 'error') return 'error';
  if (s === 'needs-action') return 'needs-action';
  return 'idle';
}

export default function SetupWizard({ detect, statuses, loginUrl, act, canLaunch }) {
  const acct = detect && detect.account;

  return (
    <div className="wizard">
      <div className="wizard-head">
        <h1>Set up your AI Co-Founder</h1>
        <p className="muted">
          A few one-time steps. Just click the buttons — no terminal knowledge needed.
        </p>
      </div>

      {detect && (
        <div className="env-summary">
          <span className="pill">{labelOs(detect.os)}</span>
          <span className="pill">Node {detect.nodeVersion}</span>
          <span className={'pill ' + (detect.claudeInstalled ? 'good' : 'warn')}>
            {detect.claudeInstalled ? `Claude ${detect.claudeVersion || ''}` : 'Claude not installed'}
          </span>
          <span className={'pill ' + (detect.loggedIn ? 'good' : 'warn')}>
            {detect.loggedIn ? (acct && acct.email ? `${acct.email}` : 'Signed in') : 'Signed out'}
          </span>
          {detect.claudeInstalled && !detect.onPath && (
            <span className="pill warn" title="Installed but not on the global PATH yet — the app still works.">
              not on global PATH
            </span>
          )}
        </div>
      )}

      <ol className="steps">
        {STEPS.map((step) => {
          const state = stepState(step.key, detect, statuses);
          const detail = statuses[step.key] && statuses[step.key].detail;
          const done = isDone(step.key, detect);
          const busy = state === 'running';
          // Only block while a step is actively running; finished steps stay
          // re-runnable (re-install/re-login are safe no-ops server-side).
          const disabled = busy;
          return (
            <li key={step.key} className={'step ' + state}>
              <div className="step-num">{done ? '✓' : step.num}</div>
              <div className="step-body">
                <div className="step-row">
                  <h3>{step.title}</h3>
                  <span className={'chip ' + state}>{CHIP_LABEL[state]}</span>
                </div>
                <p className="muted">{step.desc}</p>
                {detail && <p className="detail">{detail}</p>}
                {step.key === 'login' && loginUrl && (
                  <p className="detail">
                    Browser didn’t open?{' '}
                    <a href={loginUrl} target="_blank" rel="noreferrer">Click here to sign in →</a>
                  </p>
                )}
                <button className="btn" onClick={() => act(step.action)} disabled={disabled}>
                  {busy ? 'Working…' : (done && step.key !== 'detect' ? `${step.label} again` : step.label)}
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className={'launch-card ' + (canLaunch ? 'ready' : 'locked')}>
        <div>
          <h3>{canLaunch ? 'You’re ready 🎉' : 'Finish the steps above to launch'}</h3>
          <p className="muted">
            {canLaunch
              ? 'Start your interactive Claude session in a private workspace.'
              : 'Launch unlocks once Claude Code is installed, the skills are added, and you’re signed in.'}
          </p>
        </div>
        <button className="btn primary big" onClick={() => act(ClientMsg.SESSION_LAUNCH)} disabled={!canLaunch}>
          Launch my Co-Founder →
        </button>
      </div>
    </div>
  );
}

function labelOs(os) {
  if (os === 'darwin') return 'macOS';
  if (os === 'win32') return 'Windows';
  if (os === 'linux') return 'Linux';
  return os || 'Unknown OS';
}
