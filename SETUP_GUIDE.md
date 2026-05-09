# opencode-figma — Setup guide

## Install using OpenCode Desktop

1. Open the **OpenCode** desktop app.
2. **Open Project** and select the folder where you cloned **opencode-figma** (the repo root — the folder that contains `package.json` and `src/`).
3. Open the **integrated Terminal** in OpenCode (View → Terminal, or your usual shortcut).
4. Run:
   ```bash
   npm install
   ```
5. Run:
   ```bash
   npm run setup
   ```
6. **Fully quit and reopen OpenCode** so it picks up the plugin loader in the OpenCode plugins folder.

After that, open **Figma Desktop** and a real **design file** (a canvas tab — not only the home screen). In OpenCode, use natural language (e.g. “connect to Figma”) or invoke `figma_*` tools; the first connection may run local CDP setup automatically.

### If `npm run setup` warns about symlinks (common on Windows)

Use the stub loader instead (same outcome):

```bash
npm run setup:copy
```

Or: `node scripts/setup-local.mjs --copy`

### Local install vs `opencode.json`

For a **git clone** / local dev install, you **do not** need `"plugin": ["opencode-figma"]` in `opencode.json` — and you should **not** add it until the package is **published on npm**, or OpenCode may try to fetch it from the registry.  
The `setup` script registers the plugin by placing **`opencode-figma.js`** here:

- **Windows:** `%APPDATA%\opencode\plugins\`
- **macOS / Linux:** `~/.config/opencode/plugins/`

Override with the **`OPENCODE_PLUGINS_DIR`** environment variable if your OpenCode install uses a custom path.

---

## What `npm run setup` does

1. Installs npm dependencies (unless you pass `--skip-install` to the script).
2. Runs **`npm link`** so the `opencode-figma` CLI is on your PATH (skip with `--no-global-cli` if you only use OpenCode tools).
3. Writes **`opencode-figma.js`** into OpenCode’s plugins directory — symlink to `src/index.js` when possible, otherwise a small stub that imports the real file URL.
4. Creates **`~/.opencode-figma/settings.json`** with defaults if missing (e.g. `strict: false`).
5. Optionally runs a best-effort **`connect`** smoke test (skip with `--no-connect`).

```bash
node scripts/setup-local.mjs --help
```

---

## Use from OpenCode

Ask in plain language, for example:

- “Connect to Figma”
- “Add shadcn colors”
- “Build a button component set”
- “Render a hero section with JSX”

See **AGENTS.md** and **README.md** for tool behavior and JSX syntax.

---

## Figma and Yolo Mode (CDP)

The plugin talks to **Figma Desktop** over the **Chrome DevTools Protocol** after a one-time patch. `connect` may restart Figma with remote debugging; you need an **open design file** so a canvas tab exists.

### macOS: permission errors

**System Settings → Privacy & Security → Full Disk Access** — add the app that runs the terminal (Terminal, OpenCode, etc.), then quit and reopen that app.

---

## Uninstall / reset (fresh install)

1. Stop the daemon if you use it: `opencode-figma daemon stop`
2. Delete **`opencode-figma.js`** from `%APPDATA%\opencode\plugins\` (Windows) or `~/.config/opencode/plugins/` (macOS/Linux).
3. Remove the global link: `npm unlink -g opencode-figma`
4. Optionally delete **`%USERPROFILE%\.opencode-figma`** (Windows) or **`~/.opencode-figma`** (macOS/Linux) for a clean config.

Then run **`npm install`** and **`npm run setup`** again from the repo.

---

## CLI (optional)

After setup, from any terminal:

```bash
opencode-figma connect
opencode-figma --help
```

If the command is not found, use:

```bash
node path/to/opencode-figma/bin/opencode-figma connect
```

---

## Reference: project layout

```
opencode-figma/
├── package.json
├── bin/opencode-figma      # CLI entry
├── scripts/setup-local.mjs # install/register script
├── src/
│   ├── index.js           # OpenCode plugin export
│   ├── cli/
│   └── core/
├── README.md
├── AGENTS.md
└── SETUP_GUIDE.md
```
