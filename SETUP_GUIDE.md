# opencode-figma Plugin - Complete Setup Guide

## ✅ Installation Complete!

The `opencode-figma` plugin has been successfully created and installed.

## What Was Created

### 1. Standalone npm Package
Location: `/Users/m.milde/Work/opencode-figma`

```
opencode-figma/
├── package.json          # npm package config
├── README.md            # Documentation
├── AGENTS.md            # OpenCode instructions
├── SUMMARY.md          # Implementation details
├── bin/
│   └── opencode-figma # CLI executable
├── src/
│   ├── index.js        # OpenCode plugin (main export)
│   ├── cli/            # CLI command implementations
│   └── core/           # CDP client, patching, daemon
└── node_modules/        # Dependencies
```

### 2. OpenCode Plugin Installed
Location: `~/.config/opencode/plugins/`

The plugin has been copied to OpenCode's plugin directory and is configured in `~/.config/opencode/opencode.json`.

## Plugin Tools Available

| Tool | Description |
|------|-------------|
| `figma_connect` | Connect to Figma Desktop via Yolo Mode |
| `figma_create` | Create elements (frame, text, shapes) |
| `figma_set` | Set properties (fill, stroke, etc.) |
| `figma_tokens` | Add design tokens (shadcn, tailwind) |
| `figma_export` | Export as PNG, SVG, JSX |
| `figma_analyze` | Analyze designs (colors, typography) |
| `figma_find` | Find nodes by name/type |
| `figma_variable` | Manage Figma variables |
| `figma_daemon` | Control speed daemon |
| `figma_screenshot` | Take screenshots |

## How to Use

### As OpenCode Plugin

1. **Start OpenCode** in your project:
   ```bash
   opencode
   ```

2. **Connect to Figma** (ask OpenCode):
   ```
   "Connect to Figma"
   ```

3. **Use the tools** (ask OpenCode):
   ```
   "Add shadcn colors to my project"
   "Create a blue card with rounded corners"
   "Show me what's on the canvas"
   "Export this frame as PNG"
   ```

### As Standalone CLI

```bash
# Connect to Figma
opencode-figma connect

# Create elements
opencode-figma create frame "My Frame" --width 320 --height 200

# Add tokens
opencode-figma tokens shadcn

# Export
opencode-figma export png
```

## Configuration

### OpenCode Config (`~/.config/opencode/opencode.json`)
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-figma"],
  "mcp": {
    "pencil": {
      "command": ["/Users/m.milde/.pencil/mcp/cursor/out/mcp-server-darwin-arm64", "--app", "cursor"],
      "enabled": true,
      "type": "local"
    }
  }
}
```

### Figma Connection (`~/.opencode-figma/config.json`)
```json
{
  "patched": true,
  "cdpPort": 9274
}
```

## Yolo Mode (CDP Patching)

The plugin uses **Yolo Mode** by default:

1. **Patches Figma** to enable Chrome DevTools Protocol
2. **Random port** (9222-9322) for security
3. **Speed daemon** for 10x faster commands
4. **Cross-platform**: macOS + Windows supported

### macOS Full Disk Access

If you get permission errors:
1. Open **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Click **+** and add **Terminal**
3. Quit Terminal completely (Cmd+Q) and reopen

## Testing Status

✅ **CLI Commands**: Working (connect, create, tokens, etc.)
✅ **Plugin Structure**: Loads correctly in Node.js
✅ **Figma Connection**: Successfully connects via CDP (macOS)
✅ **OpenCode Config**: Plugin registered in opencode.json
⚠️ **Full Integration**: Needs testing in actual OpenCode session

## Next Steps

1. **Test in OpenCode**:
   - Start `opencode` in your terminal
   - Type: `"Connect to Figma"`
   - Verify the plugin tools are available

2. **Test Each Tool**:
   - `figma_create` - Create frames, text, shapes
   - `figma_tokens` - Add shadcn/tailwind tokens
   - `figma_export` - Export as PNG/SVG
   - etc.

3. **Publish to npm** (optional):
   ```bash
   cd /Users/m.milde/Work/opencode-figma
   npm publish
   ```

4. **Install on Other Computers**:
   ```bash
   npm install -g opencode-figma
   ```

## Files Summary

### Created Files
- `/Users/m.milde/Work/opencode-figma/` - Main package
- `~/.config/opencode/plugins/` - OpenCode plugin installation (macOS/Linux)
- `%APPDATA%\\opencode\\plugins\\` - OpenCode plugin installation (Windows)
- `~/.opencode-figma/config.json` - Figma connection config

### Key Features Implemented
✅ Yolo Mode (CDP patching for macOS/Windows)
✅ 10 OpenCode plugin tools
✅ Standalone CLI (works without OpenCode)
✅ Cross-platform support
✅ Speed daemon for fast commands
✅ AGENTS.md for OpenCode instructions

## Support

The plugin is based on [figma-cli](https://github.com/silships/figma-cli) by Sil Bormüller.
Modified to work with OpenCode as a native plugin.

For issues, check:
- CLI: `opencode-figma --help`
- OpenCode: Check if plugin loads in OpenCode session
- Figma: Ensure Figma Desktop is running with a file open
