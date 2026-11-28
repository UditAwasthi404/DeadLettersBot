import { forwardRef } from "react";
import { Button, type ButtonProps } from "./Button.tsx";

export type IconButtonProps = Omit<ButtonProps, "aria-label"> & { label: string };
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className = "", variant = "ghost", ...props }, ref,
) {
  return <Button {...props} ref={ref} variant={variant} aria-label={label} className={`aos-icon-button ${className}`} />;
});
export default IconButton;
