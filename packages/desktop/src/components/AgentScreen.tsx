import {
  Globe,
  LoaderCircle,
  MonitorX,
  MousePointer2,
  Pause,
  Play,
  RefreshCw,
  SquareTerminal,
  X,
} from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useState } from "react";
import deskImage from "../assets/agent-desk.jpg";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { AppButton } from "./AppButton.tsx";

export type ScreenMode = "view" | "control" | "handoff";
export type ScreenPhase = "connecting" | "live" | "error";
export type DesktopApp = "browser" | "terminal";

const PHASE_LABEL: Record<ScreenPhase, string> = {
  connecting: "Connecting",
  live: "Live",
  error: "Offline",
};

const MODE_LABEL: Record<ScreenMode, string> = {
  view: "Watching",
  control: "You're in control",
  handoff: "Finish login on this screen, then click Done",
};

type AgentScreenProps = {
  layout?: "docked" | "overlay";
  mode: ScreenMode;
  phase: ScreenPhase;
  botName: string;
  status: string;
  error: string;
  reason?: string;
  paused?: boolean;
  interactive: boolean;
  activeApp?: DesktopApp;
  canvasRef: (node: HTMLCanvasElement | null) => void;
  onRetry: () => void;
  onClose: () => void;
  onSetMode: (mode: "view" | "control") => void;
  onReturnControl: () => void;
  onTogglePause?: () => void;
  onFocusApp?: (app: DesktopApp) => void;
};

export function AgentScreen({
  layout = "overlay",
  mode,
  phase,
  botName,
  status,
  error,
  reason,
  paused = false,
  interactive,
  activeApp = "browser",
  canvasRef,
  onRetry,
  onClose,
  onSetMode,
  onReturnControl,
  onTogglePause,
  onFocusApp,
}: AgentScreenProps) {
  const controlling = interactive && phase === "live";
  const subtitle = mode === "handoff" && reason ? reason : MODE_LABEL[mode];
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const clock = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const trackCursor = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlling) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setCursor({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  const docked = layout === "docked";

  return (
    <section
      className={`agent-screen no-drag${docked ? " agent-screen--docked" : ""}${controlling ? " is-controlling" : ""}`}
      role={docked && !controlling ? "region" : "dialog"}
      aria-label={`Computer for ${botName}`}
    >
      <header className="agent-screen-bar">
        <div className="agent-screen-identity">
          <AgentAvatar kind="agent" name={botName} />
          <div>
            <strong>{botName}'s computer</strong>
            <span>{subtitle}</span>
          </div>
        </div>
        <span className={`agent-screen-status is-${phase}`}>
          <i aria-hidden="true" />
          {PHASE_LABEL[phase]}
          {status ? ` · ${status}` : ""}
        </span>
        <div className="agent-screen-actions">
          {mode === "handoff" ? (
            <AppButton type="button" className="primary" onClick={onReturnControl}>
              Done · Return to Bot
            </AppButton>
          ) : controlling ? (
            <AppButton type="button" className="primary" onClick={() => onSetMode("view")}>
              Release · Esc
            </AppButton>
          ) : (
            <>
              {onTogglePause && (
                <AppButton type="button" onClick={onTogglePause} aria-label={paused ? "Resume" : "Pause"}>
                  {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                  {paused ? "Resume" : "Pause"}
                </AppButton>
              )}
              <AppButton
                type="button"
                className="primary"
                disabled={phase !== "live"}
                onClick={() => onSetMode("control")}
              >
                <MousePointer2 size={14} aria-hidden="true" />
                Take control
              </AppButton>
            </>
          )}
          {phase !== "connecting" && (
            <AppButton type="button" onClick={onRetry} aria-label="Reset desktop">
              <RefreshCw size={14} aria-hidden="true" />
            </AppButton>
          )}
          <AppButton
            type="button"
            className="agent-screen-close"
            aria-label="Close computer"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </AppButton>
        </div>
      </header>

      <div className={`agent-desktop${interactive ? " is-interactive" : ""}`}>
        <div
          className="agent-desktop-stage"
          onPointerMove={trackCursor}
          onPointerLeave={() => setCursor(null)}
        >
          <canvas
            ref={canvasRef}
            width={1280}
            height={800}
            className="agent-screen-canvas"
            aria-label="Remote agent VM screen"
            tabIndex={interactive ? 0 : -1}
          />
          {controlling && cursor && (
            <div
              className="agent-local-cursor"
              style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
              aria-hidden="true"
            />
          )}
          {phase !== "live" && (
            <div className="agent-desktop-backdrop" aria-hidden="true">
              <img src={deskImage} alt="" />
            </div>
          )}
          {phase === "connecting" && (
            <div className="agent-screen-overlay">
              <LoaderCircle className="spin" size={28} aria-hidden="true" />
              <strong>Starting the remote desktop</strong>
              <span>{status || "Booting window manager, browser, and desktop…"}</span>
            </div>
          )}
          {phase === "error" && (
            <div className="agent-screen-overlay agent-screen-overlay--error" role="alert">
              <span className="agent-screen-error-icon" aria-hidden="true">
                <MonitorX size={22} />
              </span>
              <strong>Couldn't open the computer</strong>
              <span>{error || "The remote display is unavailable right now."}</span>
              <div className="agent-screen-error-actions">
                <AppButton type="button" className="primary" onClick={onRetry}>
                  <RefreshCw size={14} aria-hidden="true" />
                  Retry
                </AppButton>
                <AppButton type="button" onClick={onClose}>
                  Close
                </AppButton>
              </div>
            </div>
          )}
        </div>

        <nav className="agent-taskbar" aria-label="Desktop apps">
          <div className="agent-taskbar-apps">
            <button
              type="button"
              className={`agent-taskbar-app${activeApp === "browser" ? " is-active" : ""}`}
              disabled={phase !== "live" || !onFocusApp}
              onClick={() => onFocusApp?.("browser")}
            >
              <span className="agent-taskbar-icon agent-taskbar-icon--browser" aria-hidden="true">
                <Globe size={18} />
              </span>
              <span>Chrome</span>
            </button>
            <button
              type="button"
              className={`agent-taskbar-app${activeApp === "terminal" ? " is-active" : ""}`}
              disabled={phase !== "live" || !onFocusApp}
              onClick={() => onFocusApp?.("terminal")}
            >
              <span className="agent-taskbar-icon agent-taskbar-icon--terminal" aria-hidden="true">
                <SquareTerminal size={18} />
              </span>
              <span>Terminal</span>
            </button>
          </div>
          <div className="agent-taskbar-tray">
            <span className="agent-taskbar-clock">{clock}</span>
          </div>
        </nav>
      </div>
    </section>
  );
}
