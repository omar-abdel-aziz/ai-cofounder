// Interactive OAuth login driven from the UI.
//
// We run `claude auth login --claudeai` inside a PTY. This is the INTERACTIVE
// browser-OAuth path (NOT the Agent SDK and NOT `claude -p`), so it's consistent
// with the project's billing constraints. Login makes no model call, so it
// doesn't draw from any usage pool. Credentials are written to Claude Code's own
// local store (macOS Keychain / ~/.claude/.credentials.json) and never leave the
// machine.
//
// Flow: spawn -> stream the PTY to the terminal (theme/onboarding/trust dialogs,
// if any, render there) -> scan output for the OAuth URL and surface it as a
// fallback link -> poll `claude auth status` until logged in.
const paths = require('./paths');
const detect = require('./detect');
const { ServerMsg, Step, State } = require('../ws-protocol');

const URL_RE = /(https?:\/\/[^\s'"]+)/;

function startLogin({ spawn, bridge, claudePath, send, onDone }) {
  const bin = claudePath || (paths.isWin ? 'claude.exe' : 'claude');
  send({
    type: ServerMsg.STATUS, step: Step.LOGIN, state: State.RUNNING,
    detail: 'Starting sign-in — your browser should open. If it doesn\'t, use the link that appears.',
  });

  let p;
  try {
    p = spawn(bin, ['auth', 'login', '--claudeai'], paths.homedir());
  } catch (e) {
    send({ type: ServerMsg.STATUS, step: Step.LOGIN, state: State.ERROR, detail: 'Could not start login: ' + e.message });
    return;
  }
  bridge.attach(p, 'login');

  // Surface the first OAuth URL we see as a clickable fallback.
  let urlSent = false;
  p.onData((d) => {
    if (urlSent) return;
    const mm = String(d).match(URL_RE);
    if (mm) { urlSent = true; send({ type: ServerMsg.LOGIN_URL, url: mm[1] }); }
  });

  // Poll local auth status until success (or timeout).
  let elapsed = 0;
  let finished = false;
  const interval = 2000;
  const max = 5 * 60 * 1000;

  async function succeed() {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    let detail = 'Signed in.';
    try {
      const st = await detect.authStatus(bin);
      if (st && st.email) detail = `Signed in as ${st.email}${st.subscriptionType ? ' (' + st.subscriptionType + ')' : ''}.`;
    } catch {}
    send({ type: ServerMsg.STATUS, step: Step.LOGIN, state: State.OK, detail });
    if (onDone) onDone(true);
  }

  const timer = setInterval(async () => {
    if (finished) return;
    elapsed += interval;
    let loggedIn = false;
    try { loggedIn = await detect.checkLoggedIn(bin); } catch {}
    if (loggedIn) return succeed();
    if (elapsed >= max) {
      finished = true;
      clearInterval(timer);
      send({
        type: ServerMsg.STATUS, step: Step.LOGIN, state: State.NEEDS_ACTION,
        detail: 'Still waiting. Finish sign-in in your browser (use the link if needed), then click "Re-check".',
      });
      if (onDone) onDone(false);
    }
  }, interval);

  // The login process writes credentials before it exits, so once it's gone we
  // do one final check, then stop — leaving the poll timer running would leak a
  // `claude auth status` spawn every 2s for up to 5 minutes.
  p.onExit(() => {
    if (finished) return;
    setTimeout(async () => {
      if (finished) return;
      let loggedIn = false;
      try { loggedIn = await detect.checkLoggedIn(bin); } catch {}
      if (loggedIn) { succeed(); return; }
      finished = true;
      clearInterval(timer);
      send({
        type: ServerMsg.STATUS, step: Step.LOGIN, state: State.NEEDS_ACTION,
        detail: 'Sign-in didn\'t complete. Click "Sign in" to try again — or "Re-check" if you already finished in your browser.',
      });
      if (onDone) onDone(false);
    }, 800);
  });
}

module.exports = { startLogin };
