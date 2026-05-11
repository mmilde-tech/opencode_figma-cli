# opencode-figma

OpenCode plugin for Figma integration via Yolo Mode (CDP). Control Figma Desktop directly from OpenCode with full read/write access - no API key required.

## Features

- **Design Tokens** - Create variables, collections, modes (Light/Dark), bind to nodes
- **Variable binding** - `var:` on fills/strokes (COLOR) and on spacing, radius, opacity, stroke weight, text size (FLOAT) via `figma_set` and JSX (`gap`, `p`, `rounded`, …)
- **Create Anything** - Frames, text, shapes, icons, components
- **Team Libraries** - Import and use components, styles, variables from any library
- **Analyze Designs** - Colors, typography, spacing, find repeated patterns
- **Lint & Accessibility** - Contrast checker, touch targets, design rules
- **Export** - PNG, SVG, JSX, Storybook stories, CSS variables, Tailwind config
- **Batch Operations** - Rename layers, find/replace text, create variables in bulk

## Installation

The package is not on npm yet. From a clone of this repo:

### OpenCode Desktop (step-by-step)

1. Open the **OpenCode** desktop app.
2. **Open Project** and choose your cloned **opencode-figma** folder (the repo root with `package.json`).
3. Open the **integrated Terminal**.
4. Run **`npm install`**, then **`npm run setup`**.

Full detail, troubleshooting, and uninstall: **[SETUP_GUIDE.md](./SETUP_GUIDE.md)**.

### Terminal only (quick path)

```bash
cd /path/to/opencode-figma
npm install
npm run setup
```


## Quick Start

### 1. Connect to Figma (Yolo Mode)

```bash
opencode-figma connect
```

Or
```bash
figma_connect
```

Or ask OpenCode: "Connect to Figma"


### 2. Start Using It

Once connected, just talk to OpenCode:

> "Add shadcn colors to my project"

> "Create a card component"

> "Check accessibility"

> "Export this frame as PNG"

## Available Tools (OpenCode)

When using with OpenCode, the following tools are available:

| Tool | Description |
|------|-------------|
| `figma_connect` | Connect to Figma Desktop (Yolo Mode) |
| `figma_create` | Create frames, text, shapes, icons (type param) |
| `figma_set` | Set properties (fill, stroke, radius, etc.) |
| `figma_tokens` | Add design tokens (shadcn, tailwind, custom) |
| `figma_render` | Render JSX components |
| `figma_export` | Export as PNG/SVG/JSX |
| `figma_analyze` | Analyze colors, typography, spacing |
| `figma_lint` | Run accessibility linting |
| `figma_find` | Find nodes by name, type, or XPath |
| `figma_variable` | Manage variables (list, create, delete) |
| `figma_collection` | Manage collections (list, create) |
| `figma_eval` | Execute raw Figma Plugin API code |
| `figma_daemon` | Control speed daemon (start/stop/status) |

## CLI Usage (Standalone)

The package includes a standalone CLI:

```bash
# Connect to Figma
opencode-figma connect

# Add shadcn colors
opencode-figma tokens preset shadcn

# Create a frame
opencode-figma create frame "My Frame" --width 320 --height 200

# Export as PNG
opencode-figma export png "node-id" -s 2

# List variables
opencode-figma var list
```

## Requirements

- **Node.js 18+**
- **Figma Desktop** (free account works)
- **OpenCode** (for plugin usage)
- **macOS or Windows** (macOS recommended)

### macOS Full Disk Access

Yolo Mode requires patching Figma (one-time). On macOS, you need to grant Terminal "Full Disk Access":

1. Open **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Click **+** and add your Terminal app
3. Quit Terminal completely (Cmd+Q) and reopen

## How It Works

```
┌─────────────┐      WebSocket (CDP)      ┌─────────────┐
│   OpenCode  │ ◄───────────────────────► │   Figma     │
│   Plugin    │   localhost:random port  │  Desktop    │
└─────────────┘                           └─────────────┘
```

The plugin connects to Figma Desktop via Chrome DevTools Protocol (CDP). No API key needed because it uses your existing Figma session.

## Security

Yolo Mode includes these security features:
- **Random port**: CDP uses a random port between 9222-9322 per session
- **Session token**: Random 32-byte token required for daemon requests
- **Localhost only**: Connections only accepted from 127.0.0.1
- **Idle timeout**: Auto-shutdown after 10 minutes of inactivity

## Cross-Platform

| Platform | Figma Path (auto-detected) | Permissions |
|----------|---------------------------|-------------|
| macOS | `/Applications/Figma.app` (also `~/Applications/Figma.app`) | Full Disk Access for Terminal |
| Windows | `%LOCALAPPDATA%\Figma\Figma.exe` (or `app-<version>\Figma.exe`, or `Programs\Figma\Figma.exe`) | Run terminal as Administrator |
| Linux | `/usr/bin/figma`, `/opt/figma-linux/...` | `sudo` if patching system-wide install |

The plugin auto-detects the Figma install location on every platform and falls
back to the most-recently-modified install if multiple are present
(e.g. Squirrel auto-update on Windows leaves stale `app-<old>` directories).

## Troubleshooting

### Permission Error When Patching (macOS)

```
EPERM: operation not permitted
```

**Solution**: Grant Full Disk Access to Terminal:
1. **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Add your terminal app (Terminal.app, iTerm, etc.)
3. Quit the terminal completely (Cmd+Q) and reopen

Note: this repository build ships **Yolo Mode only** (there is no bundled Figma “Import plugin from manifest” package).

### Permission Error When Patching (Windows)

```
EACCES / EPERM writing app.asar
```

**Solution A**: Right-click your terminal → "Run as administrator", then:

```powershell
opencode-figma connect
```

There is no Safe Mode in this repo build; use Yolo Mode and run your terminal as Administrator on Windows if patching/launch control fails.

### Figma Not Connecting

1. Make sure Figma **Desktop** is running (not the web version)
2. Open a design file in Figma (not just the file browser)
3. Run `opencode-figma connect` again — it will reuse the saved CDP port

### "Figma executable not found"

The plugin looked for Figma in all standard install locations and didn't find
it. Make sure Figma Desktop is installed:
- macOS: download from [figma.com/downloads](https://figma.com/downloads)
- Windows: same link, or install via the Microsoft Store
- Linux: try [figma-linux](https://github.com/Figma-Linux/figma-linux) (community)

### `opencode-figma: command not found` after `npm link`

Your global npm bin isn't on `PATH`. Find it with `npm config get prefix` and
add `<prefix>/bin` (Unix) or `<prefix>` (Windows) to `PATH`.

## OpenCode / CDP vs “Figma MCP”

**MCP** (Model Context Protocol) is a standard way for an AI app to call **external tools** exposed by an **MCP server**. A **“Figma MCP”** is whatever that server implements—often tools backed by the **Figma REST API** (OAuth / tokens, cloud, rate limits) and a fixed set of operations.

**opencode-figma** is different: it is an **OpenCode plugin** (and optional **CLI**) that talks to **Figma Desktop on your machine** over **Chrome DevTools Protocol (CDP)** and runs in the **Figma plugin runtime**. You work on the **file open in Desktop** with **no Figma API key** for that path. Capabilities match what a real plugin can do in the editor, not only what one MCP server chose to wrap.

| Topic | **opencode-figma** | **Typical Figma-related MCP** |
|-------|------------------|-------------------------------|
| Link to the model | Native OpenCode `figma_*` tools (+ CLI) | MCP tools / resources |
| How it reaches Figma | Local CDP → Figma Desktop | Often HTTPS → Figma API (varies by server) |
| Auth | **No API key for the CDP desktop flow** | Often OAuth / personal access token |
| What you drive | The open desktop file | Whatever that server’s API + scopes allow |

## Copyright

© 2026 M.Milde · [m.milde@gmail.com](mailto:m.milde@gmail.com)

## License

MIT
