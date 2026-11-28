import {
  Expand,
  Globe,
  Maximize2,
  Minimize2,
  MonitorX,
  MousePointer2,
  Pause,
  Play,
  RefreshCw,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import deskImage from "../assets/agent-desk.jpg";
import { t } from "../i18n/index.ts";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { AppButton } from "./AppButton.tsx";
import { LivePill } from "./LivePill.tsx";
import { PlanChecklist, type PlanStep } from "./PlanChecklist.tsx";
import { Spinner } from "./Spinner.tsx";
import { Timeline, type TimelineEvent } from "./Timeline.tsx";

export type ScreenMode = "view" | "control" | "handoff";
export type ScreenPhase = "connecting" | "live" | "error";
export type DesktopApp = "browser" | "terminal";
export type ScreenPresentation = "docked" | "expanded" | "fullscreen";

const FRAME_W = 1280;
const FRAME_H = 800;

const MODE_LABEL: Record<ScreenMode, string> = {
  view: "Agent is working",
  control: "You're in control",
  handoff: "Waiting for you",
};

export type AgentPointer = { x: number; y: number; click?: boolean };

type AgentScreenProps = {
  presentation?: ScreenPresentation;
  mode: ScreenMode;
  phase: ScreenPhase;
  botName: string;
  status: string;
  error: string;
  reason?: string;
  paused?: boolean;
  interactive: boolean;
  activeApp?: DesktopApp;
  planSteps?: readonly PlanStep[];
  stepProgress?: { step: number; stepBudget: number } | null;
  timeline?: readonly TimelineEvent[];
  agentPointer?: AgentPointer | null;
  stripCollapsed?: boolean;
  canvasRef: (node: HTMLCanvasElement | null) => void;
  onRetry: () => void;
  onClose: () => void;
  onSetMode: (mode: "view" | "control") => void;
  onReturnControl: () => void;
  onTogglePause?: () => void;
  onFocusApp?: (app: DesktopApp) => void;
  onPresentationChange?: (next: ScreenPresentation) => void;
  onToggleStrip?: () => void;
};

function mapFrameToStage(
  pointer: AgentPointer,
  stage: DOMRect,
): { x: number; y: number } {
  const scale = Math.min(stage.width / FRAME_W, stage.height / FRAME_H);
  const drawW = FRAME_W * scale;
  const drawH = FRAME_H * scale;
  const offsetX = (stage.width - drawW) / 2;
  const offsetY = (stage.height - drawH) / 2;
  return {
    x: offsetX + pointer.x * scale,
    y: offsetY + pointer.y * scale,
  };
}

export function AgentScreen({
  presentation = "docked",
  mode,
  phase,
  botName,
  status,
  error,
  reason,
  paused = false,
  interactive,
  activeApp = "browser",
  planSteps = [],
  stepProgress = null,
  timeline = [],
  agentPointer = null,
  stripCollapsed = false,
  canvasRef,
  onRetry,
  onClose,
  onSetMode,
  onReturnControl,
  onTogglePause,
  onFocusApp,
  onPresentationChange,
  onToggleStrip,
}: AgentScreenProps) {
  const controlling = interactive && phase === "live";
  const watching = !interactive && phase === "live";
  const subtitle =
    mode === "handoff" && reason
      ? reason
      : mode === "view" && status
        ? status
        : MODE_LABEL[mode];
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [localCursor, setLocalCursor] = useState<{ x: number; y: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; click?: boolean } | null>(null);
  const [connectingLong, setConnectingLong] = useState(false);
  const clock = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    if (phase !== "connecting") {
      setConnectingLong(false);
      return;
    }
    const timer = window.setTimeout(() => setConnectingLong(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!watching || !agentPointer || !stageRef.current) {
      setGhost(null);
      return;
    }
    const mapped = mapFrameToStage(agentPointer, stageRef.current.getBoundingClientRect());
    setGhost({ ...mapped, click: agentPointer.click });
  }, [watching, agentPointer]);

  const trackCursor = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlling) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setLocalCursor({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  const pillLabel =
    mode === "handoff"
      ? reason || t("handoffPill")
      : controlling
        ? t("controlPill")
        : t("watchPill");

  const nextPresentation = (): ScreenPresentation => {
    if (presentation === "docked") return "expanded";
    if (presentation === "expanded") return "fullscreen";
    return "docked";
  };

  return (
    <section
      className={`agent-screen no-drag agent-screen--${presentation}${controlling ? " is-controlling" : ""}`}
      role={presentation === "docked" && !controlling ? "region" : "dialog"}
      aria-label={`${botName}'s computer`}
    >
      <header className="agent-screen-bar">
        <div className="agent-screen-identity">
          <AgentAvatar kind="agent" name={botName} />
          <div>
            <strong>
              {botName}
              {t("computerPossessive")}
            </strong>
            <span>{subtitle}</span>
          </div>
        </div>
        <LivePill
          live={phase === "live"}
          label={
            phase === "connecting"
              ? t("connecting")
              : phase === "error"
                ? t("offline")
                : t("live")
          }
          className={phase === "connecting" ? "is-connecting" : ""}
        />
        <div className="agent-screen-actions">
          {mode === "handoff" ? (
            <AppButton type="button" className="primary" onClick={onReturnControl}>
              {t("doneReturn")}
            </AppButton>
          ) : controlling ? (
            <AppButton type="button" className="primary" onClick={() => onSetMode("view")}>
              {t("releaseEsc")}
            </AppButton>
          ) : (
            <>
              {onTogglePause && (
                <AppButton
                  type="button"
                  onClick={onTogglePause}
                  aria-label={paused ? t("resume") : t("pause")}
                >
                  {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                  {paused ? t("resume") : t("pause")}
                </AppButton>
              )}
              <AppButton
                type="button"
                className="primary"
                disabled={phase !== "live"}
                onClick={() => onSetMode("control")}
              >
                <MousePointer2 size={14} aria-hidden="true" />
                {t("takeOver")}
              </AppButton>
            </>
          )}
          {phase !== "connecting" && (
            <AppButton type="button" onClick={onRetry} aria-label={t("reconnect")}>
              <RefreshCw size={14} aria-hidden="true" />
            </AppButton>
          )}
          {onPresentationChange && (
            <>
              <AppButton
                type="button"
                aria-label={t("expandScreen")}
                onClick={() => onPresentationChange(nextPresentation())}
              >
                {presentation === "fullscreen" ? (
                  <Minimize2 size={14} aria-hidden="true" />
                ) : presentation === "expanded" ? (
                  <Maximize2 size={14} aria-hidden="true" />
                ) : (
                  <Expand size={14} aria-hidden="true" />
                )}
              </AppButton>
            </>
          )}
          <AppButton
            type="button"
            className="agent-screen-close"
            aria-label={t("closeComputer")}
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </AppButton>
        </div>
      </header>

      <div className={`agent-desktop${interactive ? " is-interactive" : ""}`}>
        <div
          ref={stageRef}
          className="agent-desktop-stage"
          onPointerMove={trackCursor}
          onPointerLeave={() => setLocalCursor(null)}
        >
          <canvas
            ref={canvasRef}
            width={FRAME_W}
            height={FRAME_H}
            className="agent-screen-canvas"
            aria-label="Remote agent VM screen"
            tabIndex={interactive ? 0 : -1}
          />
          {controlling && localCursor && (
            <div
              className="agent-local-cursor"
              style={{ transform: `translate(${localCursor.x}px, ${localCursor.y}px)` }}
              aria-hidden="true"
            />
          )}
          {watching && ghost && (
            <div
              className={`agent-ghost-cursor${ghost.click ? " is-click" : ""}`}
              style={
                {
                  transform: `translate(${ghost.x}px, ${ghost.y}px)`,
                } as CSSProperties
              }
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
              <Spinner label={connectingLong ? t("stillConnecting") : t("connecting")} />
              <strong>{connectingLong ? t("stillConnecting") : t("startingDesktop")}</strong>
              <span>{status || t("bootingDesktop")}</span>
              {connectingLong && (
                <AppButton type="button" className="primary" onClick={onRetry}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {t("reconnect")}
                </AppButton>
              )}
            </div>
          )}
          {phase === "error" && (
            <div className="agent-screen-overlay agent-screen-overlay--error" role="alert">
              <span className="agent-screen-error-icon" aria-hidden="true">
                <MonitorX size={22} />
              </span>
              <strong>{t("computerUnavailable")}</strong>
              <span>{error || t("displayUnavailable")}</span>
              <div className="agent-screen-error-actions">
                <AppButton type="button" className="primary" onClick={onRetry}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {t("reconnect")}
                </AppButton>
                <AppButton type="button" onClick={onClose}>
                  {t("close")}
                </AppButton>
              </div>
            </div>
          )}
        </div>

        {(planSteps.length > 0 || stepProgress || timeline.length > 0) && (
          <div className={`agent-strip${stripCollapsed ? " is-collapsed" : ""}`}>
            <div className="agent-strip-head">
              <button type="button" className="agent-strip-toggle" onClick={onToggleStrip}>
                {stripCollapsed ? t("showStrip") : t("hideStrip")}
              </button>
              {stepProgress && (
                <span className="agent-strip-step" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t("stepOf", {
                    step: String(stepProgress.step),
                    total: String(stepProgress.stepBudget),
                  })}
                </span>
              )}
            </div>
            {!stripCollapsed && (
              <div className="agent-strip-body">
                {planSteps.length > 0 && (
                  <PlanChecklist steps={planSteps} className="aos-plan--compact" title={t("plan")} />
                )}
                {timeline.length > 0 && (
                  <Timeline events={timeline} title={t("recentActions")} className="aos-timeline--compact" />
                )}
              </div>
            )}
          </div>
        )}

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
            <span className="agent-taskbar-clock" style={{ fontVariantNumeric: "tabular-nums" }}>
              {clock}
            </span>
          </div>
        </nav>
      </div>

      {phase === "live" && (
        <div className="agent-takeover-pill" role="status">
          <span>{pillLabel}</span>
          {mode === "handoff" ? (
            <AppButton type="button" className="primary" onClick={onReturnControl}>
              {t("imDone")}
            </AppButton>
          ) : controlling ? (
            <AppButton type="button" className="primary" onClick={() => onSetMode("view")}>
              {t("imDone")}
            </AppButton>
          ) : (
            <AppButton
              type="button"
              className="primary"
              onClick={() => onSetMode("control")}
            >
              {t("takeOver")}
            </AppButton>
          )}
        </div>
      )}
    </section>
  );
}
