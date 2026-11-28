#!/usr/bin/env bash
# Raise Chromium or Terminal on the bot's X display (no xdotool required).
set -euo pipefail

bot_id="${1:-}"
app="${2:-browser}"
if [[ ! "$bot_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "invalid bot id" >&2
  exit 2
fi
if [[ "$app" != "browser" && "$app" != "terminal" ]]; then
  echo "app must be browser or terminal" >&2
  exit 2
fi

state_dir="$HOME/.agentos/browsers"
mapping="$state_dir/$bot_id"
if [[ ! -r "$mapping" ]]; then
  echo "browser session is not running" >&2
  exit 1
fi
read -r _port display < "$mapping"
if [[ ! "$display" =~ ^[0-9]+$ ]]; then
  echo "display mapping is invalid" >&2
  exit 1
fi
export DISPLAY=":$display"

python3 - "$app" "$bot_id" "$state_dir" <<'PY'
import os, re, subprocess, sys, time
from ctypes import (
    CFUNCTYPE,
    CDLL,
    POINTER,
    Structure,
    byref,
    c_char_p,
    c_int,
    c_long,
    c_uint,
    c_ulong,
    c_void_p,
)

app, bot_id, state_dir = sys.argv[1], sys.argv[2], sys.argv[3]
display_name = os.environ.get("DISPLAY", ":0")

class XWindowAttributes(Structure):
    _fields_ = [
        ("x", c_int), ("y", c_int), ("width", c_int), ("height", c_int),
        ("border_width", c_int), ("depth", c_int), ("visual", c_void_p),
        ("root", c_ulong), ("class", c_int), ("bit_gravity", c_int),
        ("win_gravity", c_int), ("backing_store", c_int), ("backing_planes", c_ulong),
        ("backing_pixel", c_ulong), ("save_under", c_int), ("colormap", c_ulong),
        ("map_installed", c_int), ("map_state", c_int), ("all_event_masks", c_long),
        ("your_event_mask", c_long), ("do_not_propagate_mask", c_long),
        ("override_redirect", c_int), ("screen", c_void_p),
    ]

X11 = CDLL("libX11.so.6")
ERROR_HANDLER = CFUNCTYPE(c_int, c_void_p, c_void_p)

@ERROR_HANDLER
def _ignore_x_error(_dpy, _ev):
    return 0

X11.XSetErrorHandler.argtypes = [ERROR_HANDLER]
X11.XSetErrorHandler.restype = ERROR_HANDLER
X11.XSetErrorHandler(_ignore_x_error)
X11.XOpenDisplay.argtypes = [c_char_p]
X11.XOpenDisplay.restype = c_void_p
X11.XDefaultRootWindow.argtypes = [c_void_p]
X11.XDefaultRootWindow.restype = c_ulong
X11.XGetWindowAttributes.argtypes = [c_void_p, c_ulong, POINTER(XWindowAttributes)]
X11.XGetWindowAttributes.restype = c_int
X11.XQueryTree.argtypes = [c_void_p, c_ulong, POINTER(c_ulong), POINTER(c_ulong), POINTER(POINTER(c_ulong)), POINTER(c_uint)]
X11.XQueryTree.restype = c_int
X11.XFetchName.argtypes = [c_void_p, c_ulong, POINTER(c_char_p)]
X11.XFetchName.restype = c_int
X11.XFree.argtypes = [c_void_p]
X11.XMoveResizeWindow.argtypes = [c_void_p, c_ulong, c_int, c_int, c_uint, c_uint]
X11.XMapRaised.argtypes = [c_void_p, c_ulong]
X11.XRaiseWindow.argtypes = [c_void_p, c_ulong]
X11.XSetInputFocus.argtypes = [c_void_p, c_ulong, c_int, c_ulong]
X11.XFlush.argtypes = [c_void_p]
X11.XCloseDisplay.argtypes = [c_void_p]
X11.XIconifyWindow.argtypes = [c_void_p, c_ulong, c_int]
X11.XIconifyWindow.restype = c_int
X11.XDefaultScreen.argtypes = [c_void_p]
X11.XDefaultScreen.restype = c_int

RevertToParent = 2
CurrentTime = 0


def window_name(dpy, wid):
    name = c_char_p()
    if X11.XFetchName(dpy, wid, byref(name)) and name.value:
        text = name.value.decode("utf-8", "ignore")
        X11.XFree(name)
        return text
    return ""


def walk(dpy, root):
    out = []
    def visit(wid):
        attrs = XWindowAttributes()
        if not X11.XGetWindowAttributes(dpy, wid, byref(attrs)):
            return
        root_return = c_ulong()
        parent = c_ulong()
        children = POINTER(c_ulong)()
        n = c_uint()
        name = window_name(dpy, wid)
        out.append((wid, name, attrs.width, attrs.height, attrs.x, attrs.y, attrs.map_state))
        if X11.XQueryTree(dpy, wid, byref(root_return), byref(parent), byref(children), byref(n)):
            for i in range(n.value):
                visit(children[i])
            if children:
                X11.XFree(children)
    visit(root)
    return out


def raise_resize(dpy, wid, x, y, w, h, screen):
    X11.XMapRaised(dpy, wid)
    X11.XRaiseWindow(dpy, wid)
    X11.XMoveResizeWindow(dpy, wid, x, y, w, h)
    X11.XSetInputFocus(dpy, wid, RevertToParent, CurrentTime)
    X11.XFlush(dpy)


def iconify(dpy, wid, screen):
    X11.XIconifyWindow(dpy, wid, screen)
    X11.XFlush(dpy)


def start_terminal():
    log = os.path.join(state_dir, f"xterm-{bot_id}.log")
    pid_file = os.path.join(state_dir, f"xterm-{bot_id}.pid")
    proc = subprocess.Popen(
        [
            "xterm",
            "-geometry", "120x32+80+60",
            "-fa", "Monospace", "-fs", "12",
            "-bg", "#0b0f0d", "-fg", "#d5ebe0", "-cr", "#7dffa6",
            "-title", "Terminal",
            "-xrm", "XTerm*scrollBar:true",
            "-xrm", "XTerm*rightScrollBar:true",
        ],
        stdout=open(log, "ab"),
        stderr=subprocess.STDOUT,
        env={**os.environ, "DISPLAY": display_name},
    )
    with open(pid_file, "w", encoding="utf-8") as fh:
        fh.write(str(proc.pid))
    time.sleep(0.4)


def discover_via_xwininfo():
    """xwininfo titles are more reliable than XFetchName for Chromium."""
    try:
        tree = subprocess.check_output(["xwininfo", "-root", "-tree"], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return None, []
    chrome_id = None
    terms = []
    for line in tree.splitlines():
        m = re.match(r"\s*(0x[0-9a-fA-F]+)\s+\"([^\"]*)\".*?(\d+)x(\d+)", line)
        if not m:
            continue
        wid, title, w, h = m.group(1), m.group(2), int(m.group(3)), int(m.group(4))
        lower = title.lower()
        if ("chromium" in lower or "chrome" in lower) and w >= 400 and h >= 300:
            chrome_id = int(wid, 16)
        if title == "Terminal" or "xterm" in lower:
            terms.append(int(wid, 16))
    return chrome_id, terms


dpy = X11.XOpenDisplay(display_name.encode())
if not dpy:
    print("cannot open display", file=sys.stderr)
    sys.exit(1)
root = X11.XDefaultRootWindow(dpy)
screen = X11.XDefaultScreen(dpy)
windows = walk(dpy, root)

chrome = None
terminals = []
for wid, name, w, h, x, y, mapped in windows:
    lower = name.lower()
    if ("chromium" in lower or "chrome" in lower) and w >= 400 and h >= 300:
        chrome = (wid, w, h)
    if name == "Terminal" or "xterm" in lower:
        terminals.append(wid)

info_chrome, info_terms = discover_via_xwininfo()
if info_chrome and not chrome:
    chrome = (info_chrome, 0, 0)
if info_terms and not terminals:
    terminals = info_terms

if app == "browser":
    for wid in terminals:
        iconify(dpy, wid, screen)
    if not chrome:
        print("browser window not found", file=sys.stderr)
        X11.XCloseDisplay(dpy)
        sys.exit(1)
    raise_resize(dpy, chrome[0], 0, 0, 1280, 800, screen)
    print("browser")
    X11.XCloseDisplay(dpy)
    sys.exit(0)

# terminal
if not terminals:
    X11.XCloseDisplay(dpy)
    start_terminal()
    dpy = X11.XOpenDisplay(display_name.encode())
    root = X11.XDefaultRootWindow(dpy)
    screen = X11.XDefaultScreen(dpy)
    windows = walk(dpy, root)
    terminals = [wid for wid, name, *_ in windows if name == "Terminal" or "xterm" in name.lower()]

if not terminals:
    print("terminal window not found", file=sys.stderr)
    X11.XCloseDisplay(dpy)
    sys.exit(1)

raise_resize(dpy, terminals[0], 80, 60, 1120, 640, screen)
print("terminal")
X11.XCloseDisplay(dpy)
PY
