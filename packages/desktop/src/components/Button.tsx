import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner.tsx";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className = "", children, type = "button", ...props }, ref,
) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
    className={`aos-button aos-button--${variant} aos-control--${size} ${className}`}>
    {loading && <Spinner label="Working" />}{children}
  </button>;
});
export default Button;
