import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: string;
  hint?: ReactNode;
  error?: string;
  size?: "sm" | "md";
};
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, size = "md", id, className = "", "aria-describedby": describedBy, ...props }, ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  return <div className={`aos-field ${className}`}>
    {label && <label className="aos-field-label" htmlFor={inputId}>{label}</label>}
    <input {...props} ref={ref} id={inputId} className={`aos-input aos-control--${size}`}
      aria-invalid={error ? true : props["aria-invalid"]}
      aria-describedby={[describedBy, (hint || error) ? descriptionId : undefined].filter(Boolean).join(" ") || undefined} />
    {(error || hint) && <div id={descriptionId} className={error ? "aos-field-error" : "aos-field-hint"}>{error || hint}</div>}
  </div>;
});
export default Input;
