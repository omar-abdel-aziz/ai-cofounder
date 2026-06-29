// Runs after `npm install`. Restores the execute bit on node-pty's spawn-helper
// (a common prebuild packaging issue on macOS/Linux). Never fails the install.
try {
  const { ensureSpawnHelperExecutable } = require('./fix-spawn-helper');
  const fixed = ensureSpawnHelperExecutable();
  if (fixed.length) {
    console.log(`[ai-cofounder] made node-pty spawn-helper executable (${fixed.length} file(s)).`);
  }
} catch (e) {
  // Best-effort only — the runtime self-heal in pty-manager.js is the safety net.
  console.warn('[ai-cofounder] postinstall spawn-helper fix skipped:', e && e.message);
}
