// Platform-specific paths + PATH helpers. The native Claude Code installer drops
// the binary in ~/.local/bin on both macOS and Windows.
const os = require('os');
const path = require('path');
const fs = require('fs');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function homedir() { return os.homedir(); }

// Directory the native installer writes the binary into (both platforms).
function binDir() { return path.join(os.homedir(), '.local', 'bin'); }

function claudeBinPath() {
  return path.join(binDir(), isWin ? 'claude.exe' : 'claude');
}

// Where bundled skills get installed for Claude Code to discover.
function skillsDir() { return path.join(os.homedir(), '.claude', 'skills'); }

// Windows/Linux store a plaintext credentials file here; macOS uses the Keychain.
function credentialsPath() { return path.join(os.homedir(), '.claude', '.credentials.json'); }

function fileExists(p) { try { return fs.existsSync(p); } catch { return false; } }

// Return a copy of `env` with our install bin dir prepended to PATH, so child
// PTYs find `claude` this session even before the shell rc has been reloaded.
// Handles Windows' case-insensitive 'Path' key by normalizing to 'PATH'.
function withBinOnPath(env = process.env) {
  const e = { ...env };
  const key = Object.keys(e).find((k) => k.toLowerCase() === 'path');
  const current = key ? e[key] : '';
  if (key && key !== 'PATH') delete e[key];
  e.PATH = binDir() + path.delimiter + (current || '');
  return e;
}

// Read the *user* PATH from the registry on Windows (so we don't bake the
// system PATH into the user PATH when persisting).
// Returns: the value string ('' if the value genuinely does not exist), or
// `null` if the read FAILED (so the caller never overwrites a real PATH it
// couldn't read). The literal value (e.g. "%USERPROFILE%\\...\\WindowsApps") is
// returned verbatim — it is round-tripped as REG_EXPAND_SZ by persistPathFix().
function winUserPath() {
  if (!isWin) return '';
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8' });
    const m = out.match(/\bPath\s+REG(?:_EXPAND)?_SZ\s+(.*)/i);
    return m ? m[1].trim() : null; // matched key but no value text is unexpected -> unknown
  } catch (e) {
    // Locale-independent disambiguation (reg.exe error TEXT is localized, so we
    // must not match on it): if reg.exe couldn't be executed at all, that's a
    // real read failure -> null (caller won't touch PATH). Otherwise reg ran and
    // exited non-zero; HKCU\Environment is always readable by its owner, so a
    // non-zero exit there means the Path value is simply absent -> '' (empty).
    if (e && (e.code === 'ENOENT' || (e.status == null && e.signal))) return null;
    return '';
  }
}

// Broadcast WM_SETTINGCHANGE("Environment") so Explorer and already-running
// shells refresh their cached environment block after a registry PATH edit
// (setx does this automatically; `reg add` does not). Best-effort; never throws.
function winBroadcastEnvChange() {
  if (!isWin) return;
  try {
    const { execFileSync } = require('child_process');
    const ps = [
      '$sig=@"',
      '[DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Auto)]',
      'public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,uint fuFlags,uint uTimeout,out UIntPtr lpdwResult);',
      '"@',
      '$t=Add-Type -MemberDefinition $sig -Name NativeMethods -Namespace Win32 -PassThru',
      '$r=[UIntPtr]::Zero',
      // HWND_BROADCAST=0xffff, WM_SETTINGCHANGE=0x1A, SMTO_ABORTIFHUNG=0x2
      '[void]$t::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,"Environment",0x2,5000,[ref]$r)',
    ].join('\n');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'ignore', timeout: 8000 });
  } catch {}
}

// Persist the bin dir to the user's PATH for *future* terminals. The current app
// session already works because withBinOnPath() prepends it to child env now.
// Best-effort: never throws; returns { persisted, note }.
function persistPathFix() {
  const bin = binDir();
  if (isWin) {
    const userPath = winUserPath(); // string ('' = genuinely empty) or null = read failed
    if (userPath === null) {
      // Don't risk clobbering a PATH we couldn't read.
      return { persisted: false, note: `could not read your user PATH — add ${bin} to your PATH manually.` };
    }
    const has = userPath.split(';').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(bin.toLowerCase());
    if (has) return { persisted: true, note: 'already on your user PATH (new terminals will see it).' };
    const next = userPath ? userPath.replace(/;+$/, '') + ';' + bin : bin;
    try {
      const { execFileSync } = require('child_process');
      // Use `reg add` (NOT setx): setx silently truncates values > 1024 chars and
      // downgrades REG_EXPAND_SZ -> REG_SZ (which stops %USERPROFILE%-style entries
      // like the WindowsApps dir from expanding). reg add preserves the type and
      // has no length cap. No shell is used, so `next` needs no quoting/escaping.
      execFileSync('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', next, '/f'], { stdio: 'ignore' });
      // Unlike setx, `reg add` does not notify running apps. Broadcast the change
      // so newly opened terminals/Explorer pick up the PATH without a sign-out.
      winBroadcastEnvChange();
      return { persisted: true, note: 'added to your user PATH (open a new terminal — or sign out/in — for other apps to see it).' };
    } catch {
      return { persisted: false, note: `could not persist PATH automatically — add ${bin} to your PATH manually.` };
    }
  }
  try {
    const isZsh = (process.env.SHELL || '').includes('zsh');
    const rc = path.join(os.homedir(), isZsh ? '.zshrc' : '.bashrc');
    let contents = '';
    try { contents = fs.readFileSync(rc, 'utf8'); } catch {}
    if (!contents.includes(bin)) {
      fs.appendFileSync(rc, `\n# Added by AI Co-Founder\nexport PATH="${bin}:$PATH"\n`);
    }
    return { persisted: true, note: `added to ${path.basename(rc)} (open a new terminal for system-wide use).` };
  } catch {
    return { persisted: false, note: `could not update your shell rc — add ${bin} to your PATH manually.` };
  }
}

module.exports = {
  isWin, isMac, homedir, binDir, claudeBinPath, skillsDir, credentialsPath,
  fileExists, withBinOnPath, winUserPath, persistPathFix,
};
