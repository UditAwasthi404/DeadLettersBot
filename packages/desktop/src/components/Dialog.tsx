import { Dialog as RadixDialog } from "@radix-ui/themes";
import { X } from "lucide-react";
import { useId, type ReactElement, type ReactNode } from "react";
import { IconButton } from "./IconButton.tsx";

export type DialogProps = {
  title: string;
  description?: string;
  children: ReactNode;
  trigger?: ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  footer?: ReactNode;
  className?: string;
};
export function Dialog({ title, description, children, trigger, open, defaultOpen, onOpenChange, footer, className = "" }: DialogProps) {
  return <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
    {trigger && <RadixDialog.Trigger>{trigger}</RadixDialog.Trigger>}
    <RadixDialog.Content className={`aos-dialog ${className}`} aria-describedby={description ? undefined : undefined}>
      <div className="aos-overlay-heading">
        <RadixDialog.Title className="aos-overlay-title">{title}</RadixDialog.Title>
        <RadixDialog.Close><IconButton label="Close dialog" size="sm"><X /></IconButton></RadixDialog.Close>
      </div>
      {description && <RadixDialog.Description className="aos-overlay-description">{description}</RadixDialog.Description>}
      <div className="aos-overlay-body">{children}</div>
      {footer && <div className="aos-overlay-footer">{footer}</div>}
    </RadixDialog.Content>
  </RadixDialog.Root>;
}
export default Dialog;
