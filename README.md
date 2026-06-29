# 🚀 AI Co-Founder (localhost)

Your **AI co-founder**: your *own* Claude Code, wrapped in a friendly browser UI
with business-coaching **skills**. A one-screen setup wizard installs Claude Code,
puts it on your PATH, loads the co-founder skills, and logs you in via your
browser — **all with buttons, no terminal knowledge required**. Then you get an
embedded terminal running an interactive `claude` session in a private workspace,
plus one-click skill launchers.

> **This runs on your own computer — it is not a website you visit.** You start a
> small local server on your machine and open it in your browser at
> `http://localhost`. That's by design: the app drives *your own* Claude Code with
> *your own* subscription, installs it for you, and reads your local sign-in — none
> of which a remote web page could do. Your credentials are sent **nowhere**;
> sign-in lives in Claude Code's own local store (macOS Keychain /
> `~/.claude/.credentials.json`), and the server listens on `127.0.0.1` only.

Supported: **macOS** and **Windows** (native, no WSL).

---

## Prerequisites

- **Node.js ≥ 18** — the *only* thing you install by hand (Claude Code itself is a
  native binary that the wizard installs for you).
  - macOS / Windows: download the **LTS** installer from <https://nodejs.org> and run it
    (macOS users with Homebrew can instead run `brew install node`).
  - Verify in a terminal: `node --version` → should print `v18` or higher.
- A **Claude Pro or Max** subscription (you'll sign in during setup).
- Internet access (to download the Claude Code installer and for sign-in).

You do **not** need to install Claude Code yourself — the wizard does it.

---

## Run it (from source)

You use a terminal **once** to start the app; everything after that is buttons in
your browser.

**1. Get the code** — either:
- with git: `git clone <REPO_URL>` then `cd ai-cofounder`, **or**
- download the ZIP, unzip it, and open a terminal in the unzipped `ai-cofounder` folder.

**2. Install dependencies** (first time only):

```bash
npm install
```

**3. Start it:**

```bash
npm run dev        # opens http://localhost:5173 in your browser automatically
```

Keep that terminal window **open** while you use the app (closing it stops the
server). To stop, press `Ctrl-C` in the terminal.

<details>
<summary>Alternative: production mode (<code>npm start</code>)</summary>

```bash
npm run build      # build the UI once
npm start          # serves http://localhost:3000 and opens your browser
```

Use a different port with `PORT=3100 npm start`.
</details>

Then in the browser:

1. **Check your computer** — detects your OS, whether Claude Code is installed,
   on PATH, and whether you're signed in.
2. **Install Claude Code** — runs the official native installer (live output in
   the terminal). Skipped automatically if already installed.
3. **Add co-founder skills** — copies the bundled skills into `~/.claude/skills`.
4. **Sign in to Claude** — opens your browser for OAuth. If it doesn't open
   automatically, a **clickable sign-in link** appears in the wizard.
5. **Launch my Co-Founder** — unlocks once the above are done; starts an
   interactive `claude` session in a private workspace. Run skills with one click.

If Claude Code is already installed and you're already logged in, the wizard
detects that and marks those steps done. After the one-click **Add co-founder
skills** step, **Launch** unlocks (the skills must be installed before launch).

---

## How it works (and what it deliberately does *not* do)

- Drives the **interactive `claude` CLI through a PTY** (via `node-pty`), rendered
  faithfully in the browser with **xterm.js**. Interactive mode bills against your
  subscription's normal usage pool.
- It does **not** use the Agent SDK, `claude -p` print mode, or
  `--output-format json/stream-json` (those draw from a different billing pool),
  and it never passes `--dangerously-skip-permissions`. Claude Code's own
  permission prompts render in the terminal for you to approve.
- Installs Claude Code with the **official native installer**, not npm.
- Login state is read locally with `claude auth status` (a local read — it does
  **not** call the model), with the OS credential store as a fallback.
- The server binds to **127.0.0.1 only**. No remote exposure.

```
Browser (React + xterm.js)  ⇄  WebSocket (/ws)  ⇄  Node server  ⇄  node-pty
                                                                     ├─ installer PTY
                                                                     ├─ login PTY (claude auth login)
                                                                     └─ session PTY (interactive claude)
```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs the Node server (:3000) and Vite UI (:5173) together; open **:5173**. |
| `npm run build` | Builds the UI into `web/dist`. |
| `npm start` | Serves the built UI from the Node server on **:3000** and opens the browser. |
| `npm run server` | Runs only the Node server. |

Set a different port with `PORT=3100 npm start`.

---

## Troubleshooting

- **"claude" not recognized right after install (PATH).** The app prepends the
  install dir (`~/.local/bin`) to its own child environment, so the in-app session
  works immediately, and it persists the PATH for future terminals. For *global*
  terminal use you may need to open a **new** terminal window.
- **Browser didn't open for sign-in.** Use the **sign-in link** the wizard shows,
  or complete the prompt directly in the embedded terminal.
- **Windows execution-policy blocks the installer.** The installer is invoked with
  `-ExecutionPolicy Bypass`, which handles this. If it still fails, the error +
  command are shown; you can retry.
- **`node-pty` failed to build / load.** You likely need build tools. The app
  detects this and shows a message instead of crashing.
  - **Windows:** install the “Desktop development with C++” workload (Visual Studio
    Build Tools), then `npm install` again. ConPTY (Windows 10+) is used.
  - **macOS:** install the Xcode Command Line Tools (`xcode-select --install`),
    then `npm install` again.
- **First-run onboarding (theme / trust folder).** Expected — approve it in the
  embedded terminal. Then your skill runs.
- **Port already in use.** Run with another port: `PORT=3100 npm start`.

---

## Project layout

```
ai-cofounder/
  server/            Node server: HTTP static + WebSocket + PTY orchestration
    index.js         http static + ws server, session/reconnect handling
    pty-manager.js   spawn PTYs + bridge bytes to the WebSocket
    ws-protocol.js   message-type constants
    setup/           detect.js · install.js · skills.js · login.js · paths.js
  web/               React + Vite UI (xterm.js terminal, setup wizard, launcher)
  skills/            bundled co-founder skills (one example included)
  workspaces/        per-session claude working dirs (created at runtime)
```

---

## Privacy & security

This app handles your OAuth login **locally** and transmits credentials nowhere —
auth lives in Claude Code's own credential store on your machine. Each session's
`claude` runs in its own `workspaces/<id>` directory, with Claude Code's normal
permission prompts left on. The server listens on `127.0.0.1` only.
