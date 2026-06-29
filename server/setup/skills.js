// Copy bundled co-founder skills into the user's Claude config so they load as
// /skill-name on the next claude start. SKILL.md line endings are normalized to
// LF on write (Windows CRLF can break frontmatter parsing).
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const SRC = path.join(__dirname, '..', '..', 'skills');

// Folder names of bundled skills that actually contain a SKILL.md.
function bundledSkillNames() {
  try {
    return fs.readdirSync(SRC, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(SRC, e.name, 'SKILL.md')))
      .map((e) => e.name);
  } catch { return []; }
}

// Minimal YAML frontmatter reader — just enough for name/description.
function parseFrontmatter(md) {
  const fm = {};
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const mm = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (mm) fm[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return fm;
}

// [{ name (the /command), folder, description }] for the skill launcher UI.
function listSkills() {
  return bundledSkillNames().map((folder) => {
    let name = folder;
    let description = '';
    try {
      const fm = parseFrontmatter(fs.readFileSync(path.join(SRC, folder, 'SKILL.md'), 'utf8'));
      if (fm.name) name = fm.name;
      description = fm.description || '';
    } catch {}
    return { name, folder, description };
  });
}

function copySkill(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      copySkill(s, d);
    } else if (e.name.toLowerCase() === 'skill.md') {
      fs.writeFileSync(d, fs.readFileSync(s, 'utf8').replace(/\r\n/g, '\n'));
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// Copy every bundled skill into ~/.claude/skills and verify each landed.
function installSkills() {
  const destRoot = paths.skillsDir();
  const installed = [];
  const errors = [];
  let entries = [];
  try {
    fs.mkdirSync(destRoot, { recursive: true });
    entries = fs.readdirSync(SRC, { withFileTypes: true });
  } catch (e) {
    return { installed, errors: [`No bundled skills found at ${SRC}: ${e.message}`], destRoot };
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dst = path.join(destRoot, e.name);
    try {
      copySkill(path.join(SRC, e.name), dst);
      if (fs.existsSync(path.join(dst, 'SKILL.md'))) installed.push(e.name);
      else errors.push(`${e.name}: SKILL.md missing after copy`);
    } catch (err) {
      errors.push(`${e.name}: ${err.message}`);
    }
  }
  return { installed, errors, destRoot };
}

module.exports = { installSkills, bundledSkillNames, listSkills, SRC };
