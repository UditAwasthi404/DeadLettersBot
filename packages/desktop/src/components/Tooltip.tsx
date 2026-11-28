import { Tooltip as RadixTooltip } from "@radix-ui/themes";
import type { ReactElement, ReactNode } from "react";
import { Kbd } from "./Kbd.tsx";

export type TooltipProps = { children: ReactElement; content: ReactNode; shortcut?: string; delay?: number };
export function Tooltip({ children, content, shortcut, delay = 500 }: TooltipProps) {
  return <RadixTooltip delayDuration={delay} className="aos-tooltip" content={<span className="aos-tooltip-copy">{content}{shortcut && <Kbd>{shortcut}</Kbd>}</span>}>
    {children}
  </RadixTooltip>;
}
export default Tooltip;
