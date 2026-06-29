// Pre-accept Claude Code's per-folder "Do you trust the files in this folder?"
// dialog for a workspace WE created, so non-technical users don't hit it on
// launch. Trust is recorded in ~/.claude.json under projects[<dir>]. We merge a
// minimal entry and write atomically (temp file + rename) to avoid corrupting
// that file. Best-effort: never throws; returns true only if it persisted.
const fs = require('fs');
const path = require('path');
const os = require('os');

function claudeJsonPath() { return path.join(os.homedir(), '.claude.json'); }

function pretrustWorkspace(dir) {
  const file = claudeJsonPath();
  try {
    if (!fs.existsSync(file)) return false; // no config to merge into -> let the dialog show
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!json || typeof json !== 'object') return false;
    if (!json.projects || typeof json.projects !== 'object') json.projects = {};

    // Claude keys trust by the RESOLVED real path (it resolves cwd before lookup,
    // e.g. /var -> /private/var on macOS), so match that or the entry is ignored.
    let key = dir;
    try { key = fs.realpathSync(dir); } catch {}

    const existing = (json.projects[key] && typeof json.projects[key] === 'object') ? json.projects[key] : {};
    json.projects[key] = {
      ...existing,
      hasTrustDialogAccepted: true,
      projectOnboardingSeenCount: Math.max(existing.projectOnboardingSeenCount || 0, 1),
      hasClaudeMdExternalIncludesApproved: existing.hasClaudeMdExternalIncludesApproved ?? false,
      hasClaudeMdExternalIncludesWarningShown: true,
    };

    // Atomic write: serialize to a temp file in the same dir, then rename over
    // the original (rename is atomic on the same filesystem), so a crash mid-write
    // can never leave a truncated ~/.claude.json.
    const tmp = `${file}.aicf-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
    try { fs.renameSync(tmp, file); }
    catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
    return true;
  } catch {
    return false; // graceful: the trust dialog will simply appear as normal
  }
}

module.exports = { pretrustWorkspace };
