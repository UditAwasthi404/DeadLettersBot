export type WindowBounds = { x: number; y: number; width: number; height: number };
export type WindowState = { bounds: WindowBounds; maximized: boolean };

export function parseWindowState(value: unknown, displays: WindowBounds[], minimum: { width: number; height: number }): WindowState | null {
  if (typeof value !== "object" || value === null || !("bounds" in value)) return null;
  const bounds = value.bounds;
  if (typeof bounds !== "object" || bounds === null) return null;
  if (!("x" in bounds) || !("y" in bounds) || !("width" in bounds) || !("height" in bounds)) return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") return null;
  if (width < minimum.width || height < minimum.height) return null;
  const visible = displays.some((display) => x < display.x + display.width && x + width > display.x && y < display.y + display.height && y + height > display.y);
  if (!visible) return null;
  return { bounds: { x, y, width, height }, maximized: "maximized" in value && value.maximized === true };
}
