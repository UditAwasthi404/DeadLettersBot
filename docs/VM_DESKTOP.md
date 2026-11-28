# Agent VM desktop

The browser VM runs a lightweight Linux desktop for computer-use: **Openbox** window manager, **tint2** bottom panel, **Chromium** at a fixed **1280×800** virtual screen, optional **xterm** (iconified until opened), **xdotool** for pointer sync, and **x11vnc** for the desktop app live view.

## Resolution: 1280×800 vs terminal layout

| Surface | Size | Notes |
|--------|------|--------|
| Xvfb virtual screen | 1280×800×24 | Canonical agent resolution for screenshots and VNC |
| Chromium (browser focus) | 1280×800 at (0,0) | Fills the canvas; `about:blank` start, no first-run UI |
| xterm (terminal focus) | 1120×640 at (80,60) | Leaves margin for Openbox decorations and the tint2 bar (~32px) |

The desktop app taskbar can raise **Browser** or **Terminal** via `POST /v1/bots/:id/desktop/focus` (implemented in `agentos-desktop-focus.sh` on the VM).

## Components

- **`ensure-bot-browser.sh`** — Allocates display/port, starts Xvfb, Openbox, tint2, iconified xterm, Chromium with CDP on loopback plus a Perl **CDP proxy** on `0.0.0.0` for the account bridge.
- **`agentos-desktop-focus.sh`** — Raises browser or terminal without xdotool (X11 + optional xwininfo).
- **`agentos-pointer.sh`** — Pointer warps via xdotool when available.
- **`ensure-bot-vnc.sh`** — x11vnc for RFB streaming to the desktop client.

## Chromium profile defaults

On first start for a bot, `Initial Preferences` are copied into the profile so Chromium skips default-browser prompts, sync promos, and restore dialogs. Homepage is `about:blank`.

## Memory and startup

Chromium flags in `ensure-bot-browser.sh` disable sync, extensions, background networking, and GPU (typical container setup). Openbox runs with `--sm-disable`. tint2 is a single lightweight panel process per display.

Rebuild the VM image after changing Docker assets:

```sh
docker compose --project-directory . -f infra/docker/docker-compose.yml build vm
```

## Local verification

- CDP: `curl http://127.0.0.1:<port>/json/version` inside the VM (after `agentos-ensure-browser <bot-uuid>`).
- VNC: connect through the gateway WebSocket / desktop client after a bot session starts.
- Computer-use tests: `pnpm --filter @agentos/tools test` (see [Computer use](COMPUTER_USE.md)).