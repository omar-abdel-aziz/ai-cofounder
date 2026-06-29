// node-pty's prebuilt `spawn-helper` (macOS/Linux) sometimes extracts without the
// execute bit, which makes pty.fork() fail with "posix_spawnp failed". We restore
// it. Called from postinstall AND at runtime in pty-manager (so it self-heals even
// when deps were installed with --ignore-scripts). No-op on Windows (ConPTY).
const fs = require('fs');
const path = require('path');

function ensureSpawnHelperExecutable() {
  const fixed = [];
  if (process.platform === 'win32') return fixed;

  let nodePtyDir;
  try { nodePtyDir = path.dirname(require.resolve('node-pty/package.json')); }
  catch { return fixed; }

  const candidates = [];
  const prebuilds = path.join(nodePtyDir, 'prebuilds');
  try {
    for (const d of fs.readdirSync(prebuilds)) {
      candidates.push(path.join(prebuilds, d, 'spawn-helper'));
    }
  } catch {}
  candidates.push(path.join(nodePtyDir, 'build', 'Release', 'spawn-helper'));

  for (const f of candidates) {
    try {
      if (!fs.existsSync(f)) continue;
      const mode = fs.statSync(f).mode;
      if (!(mode & 0o111)) { fs.chmodSync(f, 0o755); fixed.push(f); }
    } catch {}
  }
  return fixed;
}

module.exports = { ensureSpawnHelperExecutable };
