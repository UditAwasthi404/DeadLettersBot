import { Popover as RadixPopover } from "@radix-ui/themes";
import { X } from "lucide-react";
import { useId, type ReactElement, type ReactNode } from "react";
import { IconButton } from "./IconButton.tsx";

export type PopoverProps = { trigger: ReactElement; title: string; children: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; side?: "top" | "right" | "bottom" | "left" };
export function Popover({ trigger, title, children, open, defaultOpen, onOpenChange, side = "bottom" }: PopoverProps) {
  const titleId = useId();
  return <RadixPopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
    <RadixPopover.Trigger>{trigger}</RadixPopover.Trigger>
    <RadixPopover.Content side={side} className="aos-popover" aria-labelledby={titleId}>
      <div className="aos-overlay-heading"><h3 id={titleId}>{title}</h3>
        <RadixPopover.Close><IconButton label="Close popover" size="sm"><X /></IconButton></RadixPopover.Close>
      </div>
      {children}
    </RadixPopover.Content>
  </RadixPopover.Root>;
}
export default Popover;
