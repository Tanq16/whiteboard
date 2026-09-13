# Whiteboard

A minimalist, local-first infinite canvas whiteboard served by a single Go binary.

## Features

- Infinite canvas with pan and zoom.
- Stylus and pen mode with pressure-sensitive strokes via `perfect-freehand`.
- Palm rejection ignoring touch inputs while drawing.
- Two-finger canvas navigation and pinch zoom.
- Clean vector primitives: lines, arrows, rectangles, and circles.
- Handwritten text tool using the embedded Virgil font.
- Ephemeral laser pointer for live presentations.
- Export to PNG and SVG.
- PWA installable on tablets and desktop browsers.
- Catppuccin Mocha theme.

## Build

```bash
make assets
make build
```

## Run

```bash
./whiteboard serve --port 8080
```
