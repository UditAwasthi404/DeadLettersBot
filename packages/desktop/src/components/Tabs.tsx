import { Tabs as RadixTabs } from "@radix-ui/themes";
import type { ReactNode } from "react";

export type TabItem = { value: string; label: string; content: ReactNode; disabled?: boolean };
export type TabsProps = { label: string; items: readonly TabItem[]; value?: string; defaultValue?: string; onValueChange?: (value: string) => void; className?: string };
export function Tabs({ label, items, value, defaultValue, onValueChange, className = "" }: TabsProps) {
  return <RadixTabs.Root value={value} defaultValue={defaultValue ?? items.find((item) => !item.disabled)?.value} onValueChange={onValueChange} className={`aos-tabs ${className}`}>
    <RadixTabs.List aria-label={label} className="aos-tabs-list">
      {items.map((item) => <RadixTabs.Trigger key={item.value} value={item.value} disabled={item.disabled} className="aos-tab">{item.label}</RadixTabs.Trigger>)}
    </RadixTabs.List>
    {items.map((item) => <RadixTabs.Content key={item.value} value={item.value} className="aos-tab-panel">{item.content}</RadixTabs.Content>)}
  </RadixTabs.Root>;
}
export default Tabs;
