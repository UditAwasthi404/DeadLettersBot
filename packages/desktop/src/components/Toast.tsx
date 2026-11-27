import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";

export type ToastKind = "error" | "success";

type ToastProps = {
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
};

const LIFETIME_MS: Record<ToastKind, number> = { error: 8000, success: 3500 };
const ICONS = { error: TriangleAlert, success: CheckCircle2 } as const;

function Toast({ kind, message, onDismiss }: ToastProps) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const lifeMs = LIFETIME_MS[kind];
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), lifeMs);
    return () => window.clearTimeout(timer);
  }, [message, lifeMs]);
  const Icon = ICONS[kind];
  return (
    <div className={`toast toast--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="toast-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <span className="toast-message">{message}</span>
      <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={onDismiss}>
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastStack({
  error,
  notice,
  onDismissError,
  onDismissNotice,
}: {
  error: string;
  notice: string;
  onDismissError: () => void;
  onDismissNotice: () => void;
}) {
  if (!error && !notice) return null;
  return (
    <div className="toast-viewport">
      {error && (
        <Toast key={`error:${error}`} kind="error" message={error} onDismiss={onDismissError} />
      )}
      {notice && (
        <Toast
          key={`notice:${notice}`}
          kind="success"
          message={notice}
          onDismiss={onDismissNotice}
        />
      )}
    </div>
  );
}