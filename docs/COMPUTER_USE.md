# Computer use

The bot drives the account browser with the `Computer` tool: a short plan, a screenshot with numbered marks, then mouse and keyboard actions. Each action returns whether the screen changed.

## Pointer

Clicks always go through Chrome. The cursor on the agent screen also moves when a pointer helper can reach the bot's X display.

On a current VM image, `/usr/local/bin/agentos-pointer` uses `xdotool`. If that helper or `xdotool` is missing, the runtime sends a small Node script into the container. The script uses `xdotool` when it is already on `PATH`, and otherwise speaks the X11 `WarpPointer` request to that bot's display socket. No image rebuild is required for the fallback.

The display must belong to the bot (`~/.agentos/browsers/<botId>`). If both helpers fail, clicks still land in the page and the OS cursor stays put. The failure is logged once, then pointer moves are skipped for the rest of the turn.

To put `xdotool` in new images, rebuild `infra/docker/Dockerfile.vm`. The image installs `xdotool`. As root, the shell helper can also `apt-get install xdotool` on first use. The `agent` user cannot.

## What the model should do

1. `Computer` action `plan` with a few steps.
2. `screenshot`, then click a numbered `mark` (or a query such as `send`).
3. Read `verified`. If it is false, follow `recovery`: another mark, scroll, Tab, or a fresh screenshot.
4. On a login, captcha, or payment wall, `SecureHandoff`. Do not type passwords.

`zoom` crops a small area. `tabs` and `switch_tab` cover popups. `dialog` with `accept: true` confirms the next dialog; dialogs are dismissed until then. `upload` needs file paths the host running Playwright can read. `download` saves the latest download under the host temp directory and returns the path and size.

## Desktop

The agent screen shows the plan, the step budget, and a short timeline. Pause holds the turn between steps. Take over pauses and gives you the pointer. Resume continues the turn. `AGENTOS_DISABLE_GPU=1` forces software rendering; `0` keeps the GPU on.

## Local check

`packages/tools/src/computer-e2e.test.ts` serves a page with an icon-only send button and drives it with Playwright. It skips when Chromium cannot launch. Install the browser with `pnpm --filter @agentos/tools exec playwright install chromium` when you want that test to run.
