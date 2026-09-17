<div align="center">
  <img src=".github/assets/logo.svg" alt="whiteboard Logo" width="300">
  <h1>whiteboard</h1>

  <a href="https://github.com/Tanq16/whiteboard/actions/workflows/release.yaml"><img alt="Build Workflow" src="https://github.com/Tanq16/whiteboard/actions/workflows/release.yaml/badge.svg"></a>&nbsp;<a href="https://github.com/Tanq16/whiteboard/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/Tanq16/whiteboard"></a><br><br>
  <a href="#features">Features</a> &bull; <a href="#install">Install</a> &bull; <a href="#usage">Usage</a>
</div>

---

whiteboard is a minimalist, self-hosted infinite canvas whiteboard served by a single Go binary. It holds one board that every device pointed at the server draws on, for sketching, diagramming, and handwritten notes with pressure-sensitive stylus strokes. It is not a hosted suite with accounts and separate rooms, or a heavy vector illustration editor.

## Features

- One board shared across every connected device, kept in step over server-sent events.
- Infinite pan and zoom canvas with multi-touch gestures and mouse wheel navigation.
- Smooth pressure-sensitive pen drawing backed by Catmull-Rom spline interpolation.
- Palm rejection ignoring touch drawing inputs while pen mode is active.
- Canvas element selection with drag box marquee selection, Command-click multi-selection, and group translation.
- Single-point dot selection and manipulation for quick taps and pen points.
- Clean vector primitives for lines, arrows, rectangles, and circles.
- Object eraser that removes every whole element a drag passes over in one undoable action.
- Handwritten text tool with embedded Virgil font and variable font sizing.
- Pure bar stroke width and text size picker spanning 0.5px to 24px.
- Ephemeral laser pointer trail with smooth tapering and glow for live presentations.
- Popover modals for color swatches, size bars, and shape selection.
- High-resolution PNG and SVG export directly from canvas drawings.
- JSON export of the whole board, and a JSON import that replaces the canvas with the file's contents in one undoable action.
- PWA installable with standalone display and Catppuccin Mocha palette.

## Install

### GitHub Releases

Pre-compiled standalone binaries are available on the [releases page](https://github.com/Tanq16/whiteboard/releases):

| Platform | Architecture | Binary |
|---|---|---|
| Linux | amd64 (x86_64) | `whiteboard-linux-amd64` |
| Linux | arm64 (aarch64) | `whiteboard-linux-arm64` |
| macOS | Apple Silicon (arm64) | `whiteboard-darwin-arm64` |
| macOS | Intel (amd64) | `whiteboard-darwin-amd64` |

### Building from Source

Requires Go 1.27 or later.

```bash
git clone https://github.com/Tanq16/whiteboard.git
cd whiteboard
make assets
make build
```

## Usage

Start the whiteboard server:

```bash
./whiteboard serve --port 8080
```

### Flags

| Flag | Default | Description |
|---|---|---|
| `--port` | `8080` | Port for the local web server |
| `--host` | `0.0.0.0` | Bind address for the server |
| `--debug` | `false` | Enable debug logging output |

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `V` or `1` | Select tool |
| `H` | Hand / Pan tool |
| `P` | Pen tool |
| `E` | Eraser |
| `K` | Laser pointer |
| `R` | Rectangle tool |
| `C` | Circle tool |
| `L` | Line tool |
| `A` | Arrow tool |
| `T` | Text tool |
| `Cmd` / `Ctrl` + click | Toggle element in selection |
| `Backspace` / `Delete` | Delete selected elements |
| `Cmd` / `Ctrl` + `Z` | Undo action |
| `Cmd` / `Ctrl` + `Y` | Redo action |
| `+` / `-` | Zoom in / Zoom out |
| `0` | Fit the drawing to the screen and center it |
| `Escape` | Deselect elements or close menus |

## Notes

- **Server-held state**: The board lives in the serving process, so it is gone when that process restarts and nothing is written to disk.
- **Whole-action sync**: A stroke reaches other devices when it is finished rather than while it is being drawn, and the same goes for a move, a restyle, and a delete.
- **Per-device undo**: Undo and redo walk the actions taken in that browser, so undoing never rolls back what another device drew. The result broadcasts like any other edit.
- **Offline edits**: Drawing continues while the server is unreachable, the toolbar dot turns red, and the queued actions are sent once it returns.
- **Import replaces the board**: Importing a JSON file discards whatever is on the canvas across every connected device, and one undo puts it back on the device that imported.
- **No external requests**: Nothing beyond your own server is contacted, and all web assets, styles, and fonts are vendored into the compiled binary via Go embed.
