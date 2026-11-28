import en from "./en.json";

export type MessageKey = keyof typeof en;
export function t(key: MessageKey, values: Record<string, string> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
