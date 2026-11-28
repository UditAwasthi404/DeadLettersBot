import { forwardRef, useCallback, useId, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
  minRows?: number;
  maxRows?: number;
};

export function autosizeTextarea(element: HTMLTextAreaElement, minRows = 1, maxRows = 12): void {
  const minimum = Math.max(1, Math.min(12, Math.floor(minRows) || 1));
  const maximum = Math.max(minimum, Math.min(12, Math.floor(maxRows) || 12));
  const style = getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 20;
  const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  const border = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
  element.style.height = "auto";
  const minHeight = lineHeight * minimum + padding;
  const maxHeight = lineHeight * maximum + padding;
  const contentHeight = Math.max(minHeight, element.scrollHeight);
  const height = Math.min(contentHeight, maxHeight);
  element.style.height = `${style.boxSizing === "border-box" ? height + border : height - padding}px`;
  element.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, minRows = 1, maxRows = 12, rows, id, className = "", onChange, value, defaultValue, "aria-describedby": describedBy, ...props }, forwardedRef,
) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const elementRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    if (elementRef.current) autosizeTextarea(elementRef.current, rows ?? minRows, maxRows);
  }, [rows, minRows, maxRows]);
  useLayoutEffect(resize, [resize, value, defaultValue]);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let width = element.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth !== undefined && nextWidth !== width) { width = nextWidth; resize(); }
    });
    observer?.observe(element);
    window.addEventListener("resize", resize);
    return () => { observer?.disconnect(); window.removeEventListener("resize", resize); };
  }, [resize]);
  return <div className={`aos-field ${className}`}>
    {label && <label className="aos-field-label" htmlFor={textareaId}>{label}</label>}
    <textarea {...props} id={textareaId} rows={Math.max(1, Math.min(12, rows ?? minRows))}
      ref={(element) => { elementRef.current = element; if (typeof forwardedRef === "function") forwardedRef(element); else if (forwardedRef) forwardedRef.current = element; }}
      value={value} defaultValue={defaultValue} className="aos-input aos-textarea"
      aria-invalid={error ? true : props["aria-invalid"]}
      aria-describedby={[describedBy, (hint || error) ? `${textareaId}-description` : undefined].filter(Boolean).join(" ") || undefined}
      onChange={(event) => { resize(); onChange?.(event); }} />
    {(hint || error) && <div id={`${textareaId}-description`} className={error ? "aos-field-error" : "aos-field-hint"}>{error || hint}</div>}
  </div>;
});
export default Textarea;
