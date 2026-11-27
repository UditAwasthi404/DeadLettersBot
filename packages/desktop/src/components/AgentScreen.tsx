import {
  LoaderCircle,
  Monitor,
  MonitorX,
  MousePointer2,
  RefreshCw,
  X,
} from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import deskImage from "../assets/agent-desk.jpg";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { AppButton } from "./AppButton.tsx";

export type ScreenMode = "view" | "control" | "handoff";
export type ScreenPhase = "connecting" | "live" | "error";

const PHASE_LABEL: Record<ScreenPhase, string> = {
  connecting: "Connecting",
  live: "Live",
  error: "Offline",
};

const MODE_LABEL: Record<ScreenMode, string> = {
  view: "Watching",
  control: "You're in control",
  handoff: "Control handed to you",
};

type AgentScreenProps = {
  mode: ScreenMode;
  phase: ScreenPhase;
  botName: string;
  status: string;
  error: string;
  reason?: string;
  interactive: boolean;
  canvasRef: (node: HTMLCanvasElement | null) => void;
  onRetry: () => void;
  onClose: () => void;
  onSetMode: (mode: "view" | "control") => void;
  onReturnControl: () => void;
};

export function AgentScreen({
  mode,
  phase,
  botName,
  status,
  error,
  reason,
  interactive,
  canvasRef,
  onRetry,
  onClose,
  onSetMode,
  onReturnControl,
}: AgentScreenProps) {
  const controlling = interactive && phase === "live";
  const subtitle = mode === "handoff" && reason ? reason : MODE_LABEL[mode];
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const trackCursor = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlling) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setCursor({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  return (
    <section
      className={`agent-screen no-drag${controlling ? " is-controlling" : ""}`}
      role="dialog"
      aria-label={`Computer for ${botName}`}
    >
      {controlling ? (
        <div className="agent-control-bar" role="toolbar" aria-label="Control session">
          <span className="agent-control-pill">
            <i aria-hidden="true" />
            Controlling {botName}
          </span>
          <span className="agent-control-hint">Click · type · drag windows · Esc releases</span>
          {mode === "handoff" ? (
            <AppButton type="button" className="primary" onClick={onReturnControl}>
              Return to Bot
            </AppButton>
          ) : (
            <AppButton type="button" className="primary" onClick={() => onSetMode("view")}>
              Release · Esc
            </AppButton>
          )}
          <AppButton type="button" onClick={onRetry} aria-label="Reset desktop">
            <RefreshCw size={14} aria-hidden="true" />
            Reset
          </AppButton>
          <AppButton
            type="button"
            className="agent-screen-close"
            aria-label="Close computer"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </AppButton>
        </div>
      ) : (
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
          </span>
          <div className="agent-screen-actions">
            {mode === "handoff" ? (
              <AppButton type="button" className="primary" onClick={onReturnControl}>
                Return to Bot
              </AppButton>
            ) : (
              <AppButton
                type="button"
                className="primary"
                disabled={phase !== "live"}
                onClick={() => onSetMode("control")}
              >
                <MousePointer2 size={14} aria-hidden="true" />
                Take control
              </AppButton>
            )}
            {phase !== "connecting" && (
              <AppButton type="button" onClick={onRetry} aria-label="Reset desktop">
                <RefreshCw size={14} aria-hidden="true" />
                Reset
              </AppButton>
            )}
            <AppButton
              type="button"
              className="agent-screen-close"
              aria-label="Close computer"
              onClick={onClose}
            >
              <X size={15} aria-hidden="true" />
              Close
            </AppButton>
          </div>
        </header>
      )}

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
              <span>{status || "Booting window manager, browser, and terminal…"}</span>
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
      </div>

      {!controlling && (
        <footer className="agent-screen-hint">
          <Monitor size={13} aria-hidden="true" />
          {phase === "live"
            ? "Live VM desktop · browser on top, terminal below · Take control to click and type"
            : "The agent’s browser and terminal run inside this desktop"}
        </footer>
      )}
    </section>
  );
}
