import { LoaderCircle, Monitor, MonitorX, MousePointer2, RefreshCw, X } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { AppButton } from "./AppButton.tsx";

export type ScreenMode = "view" | "control" | "handoff";
export type ScreenPhase = "connecting" | "live" | "error";

const PHASE_LABEL: Record<ScreenPhase, string> = {
  connecting: "Connecting",
  live: "Live",
  error: "Unavailable",
};

const MODE_LABEL: Record<ScreenMode, string> = {
  view: "Live view",
  control: "You're in control",
  handoff: "Control handed off",
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
  const subtitle =
    mode === "handoff" && reason ? reason : MODE_LABEL[mode];
  return (
    <section
      className="agent-screen"
      role="dialog"
      aria-label={`Agent screen for ${botName}`}
    >
      <header className="agent-screen-bar">
        <div className="agent-screen-identity">
          <AgentAvatar kind="agent" name={botName} />
          <div>
            <strong>{botName}</strong>
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
            <>
              <AppButton
                type="button"
                className={mode === "control" ? undefined : "primary"}
                disabled={phase !== "live"}
                onClick={() => onSetMode(mode === "control" ? "view" : "control")}
              >
                <MousePointer2 size={14} aria-hidden="true" />
                {mode === "control" ? "Release control" : "Take control"}
              </AppButton>
              <AppButton
                type="button"
                className="agent-screen-close"
                aria-label="Close agent screen"
                title="Close agent screen"
                onClick={onClose}
              >
                <X size={15} aria-hidden="true" />
              </AppButton>
            </>
          )}
        </div>
      </header>
      <div className={`agent-screen-stage${interactive ? " is-interactive" : ""}`}>
        <canvas
          ref={canvasRef}
          width={1280}
          height={800}
          className="agent-screen-canvas"
          aria-label="Remote agent VM screen"
          tabIndex={interactive ? 0 : -1}
        />
        {phase === "connecting" && (
          <div className="agent-screen-overlay">
            <LoaderCircle className="spin" size={26} aria-hidden="true" />
            <strong>Connecting to the agent screen</strong>
            <span>{status || "Starting the remote display…"}</span>
          </div>
        )}
        {phase === "error" && (
          <div className="agent-screen-overlay agent-screen-overlay--error" role="alert">
            <span className="agent-screen-error-icon" aria-hidden="true">
              <MonitorX size={22} />
            </span>
            <strong>Couldn't open the agent screen</strong>
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
      {interactive && phase === "live" && (
        <footer className="agent-screen-hint">
          <Monitor size={13} aria-hidden="true" />
          Click the screen to type and control · <kbd>Esc</kbd> releases control
        </footer>
      )}
    </section>
  );
}