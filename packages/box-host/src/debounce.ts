export function createDebouncer(
  waitMs: number,
  schedule: (fn: () => void, ms: number) => () => void = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
) {
  const timers = new Map<string, () => void>();
  return {
    trigger(key: string, fire: () => void) {
      timers.get(key)?.();
      timers.set(
        key,
        schedule(() => {
          timers.delete(key);
          fire();
        }, waitMs),
      );
    },
    clear(key?: string) {
      if (key) {
        timers.get(key)?.();
        timers.delete(key);
        return;
      }
      for (const cancel of timers.values()) cancel();
      timers.clear();
    },
  };
}
