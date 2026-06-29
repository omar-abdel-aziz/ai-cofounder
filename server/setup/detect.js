// Environment detection: where is claude, what version, is it on PATH, is the
// user logged in, are our skills installed.
//
// Login detection uses `claude auth status` (a LOCAL read — it does NOT call the
// model, so it doesn't touch the subscription/API billing pools and is safe to
// poll). We never use `claude -p` as a probe (that would draw from the wrong
// billing pool, per the project constraints). Credential-store checks are kept
// as a cross-platform fallback.
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const execFileP = promisify(execFile);
const paths = require('./paths');
const skills = require('./skills');

async function which(cmd) {
  const finder = paths.isWin ? 'where' : 'which';
  try {
    const { stdout } = await execFileP(finder, [cmd], { timeout: 5000 });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch { return null; }
}

async function getVersion(binPath) {
  try {
    const { stdout } = await execFileP(binPath, ['--version'], { timeout: 8000 });
    const m = stdout.match(/\d+\.\d+\.\d+/);
    return m ? m[0] : (stdout.trim().split(/\r?\n/)[0] || null);
  } catch { return null; }
}

// `claude auth status` prints JSON like:
//   { "loggedIn": true, "authMethod": "claude.ai", "email": "...", "subscriptionType": "max" }
// On logout it may exit non-zero; we still try to parse any JSON it emitted.
async function authStatus(binPath) {
  const bin = binPath || (paths.isWin ? 'claude.exe' : 'claude');
  try {
    const { stdout } = await execFileP(bin, ['auth', 'status'], { timeout: 8000 });
    return JSON.parse(stdout);
  } catch (e) {
    if (e && e.stdout) { try { return JSON.parse(e.stdout); } catch {} }
    return null;
  }
}

// Fallback when `auth status` is unavailable: look for the credential store.
async function checkCredStore() {
  if (paths.isWin || process.platform === 'linux') {
    return paths.fileExists(paths.credentialsPath());
  }
  // macOS: a keychain item named "Claude Code-credentials" means logged in.
  try {
    await execFileP('security', ['find-generic-password', '-s', 'Claude Code-credentials'], { timeout: 5000 });
    return true; // exit 0
  } catch { return false; }
}

async function checkLoggedIn(binPath) {
  const st = await authStatus(binPath);
  if (st && typeof st.loggedIn === 'boolean') return st.loggedIn;
  return checkCredStore();
}

async function detect() {
  const osName = process.platform; // 'darwin' | 'win32' | 'linux'
  const nodeVersion = process.version;

  const resolved = await which('claude');
  const known = paths.claudeBinPath();
  const knownExists = paths.fileExists(known);

  const claudePath = resolved || (knownExists ? known : null);
  const onPath = !!resolved;
  const claudeInstalled = !!claudePath;
  const claudeVersion = claudeInstalled ? await getVersion(claudePath) : null;

  let loggedIn = false;
  let account = null;
  if (claudeInstalled) {
    const st = await authStatus(claudePath);
    if (st && typeof st.loggedIn === 'boolean') {
      loggedIn = st.loggedIn;
      if (loggedIn) {
        account = {
          email: st.email || null,
          subscriptionType: st.subscriptionType || null,
          authMethod: st.authMethod || null,
        };
      }
    } else {
      loggedIn = await checkCredStore();
    }
  }

  const bundled = skills.bundledSkillNames();
  const skillsInstalled = bundled.length > 0 &&
    bundled.every((n) => paths.fileExists(path.join(paths.skillsDir(), n, 'SKILL.md')));

  let detail = claudeInstalled
    ? `Claude Code ${claudeVersion || '?'} detected`
    : 'Claude Code is not installed yet';
  if (claudeInstalled && !onPath) {
    detail += ' — installed but not on your global PATH yet (the app still works)';
  }

  return {
    os: osName, nodeVersion, claudeInstalled, claudePath, claudeVersion,
    onPath, loggedIn, account, skillsInstalled, detail,
  };
}

module.exports = { detect, checkLoggedIn, authStatus, which, getVersion };
