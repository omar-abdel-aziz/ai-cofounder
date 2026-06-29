// Install Claude Code with the official NATIVE installer (not npm — the npm
// package is deprecated). The installer runs inside a PTY so its output streams
// live to the embedded terminal. After it exits we re-detect and, if needed,
// fix PATH (prepend to child env happens automatically via withBinOnPath; this
// step also persists it for future terminals).
const detect = require('./detect');
const paths = require('./paths');
const { ServerMsg, Step, State } = require('../ws-protocol');

// [file, args] for the native installer, per platform.
function installCommand() {
  if (process.platform === 'win32') {
    return ['powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-Command', 'irm https://claude.ai/install.ps1 | iex',
    ]];
  }
  // bash -lc so the installer's PATH writes behave like a login shell.
  return ['bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash']];
}

// runInstall({ spawn, bridge, send }) -> Promise (resolves when finished).
//   spawn  : pty-manager.spawnPty
//   bridge : the session's Bridge (attaches the installer PTY to the terminal)
//   send   : function(msgObj) -> emits a server->client message
function runInstall({ spawn, bridge, send }) {
  return new Promise((resolve) => {
    const [file, args] = installCommand();
    let p;
    try {
      p = spawn(file, args, paths.homedir());
    } catch (e) {
      send({ type: ServerMsg.STATUS, step: Step.INSTALL, state: State.ERROR, detail: 'Could not start installer: ' + e.message });
      return resolve();
    }
    bridge.attach(p, 'install');

    p.onExit(async ({ exitCode }) => {
      const result = await detect.detect();
      if (!result.claudeInstalled) {
        send({
          type: ServerMsg.STATUS, step: Step.INSTALL, state: State.ERROR,
          detail: `Installer exited (code ${exitCode}) but Claude Code wasn't found. Check the log above — if your network blocks the download, click Install to retry.`,
        });
        return resolve();
      }
      let detail = `Installed Claude Code ${result.claudeVersion || ''}`.trim() + '.';
      if (!result.onPath) {
        const fix = paths.persistPathFix();
        detail += ' Available to this app now; ' + fix.note;
      }
      send({ type: ServerMsg.STATUS, step: Step.INSTALL, state: State.OK, detail });
      resolve();
    });
  });
}

module.exports = { runInstall, installCommand };
