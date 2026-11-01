/** Five-field cron parser supporting wildcards, lists, ranges and steps. */
function fieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
  sunday = false,
): boolean {
  return field.split(",").some((part) => {
    // An empty list item must not fall through to the whole range.
    if (!part) return false;
    const [base, stepText, extra] = part.split("/");
    if (extra !== undefined) return false;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return false;
    let start = min;
    let end = max;
    if (base && base !== "*") {
      if (base.includes("-")) {
        const [aText, bText] = base.split("-");
        const a = Number(aText);
        const b = Number(bText);
        if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) return false;
        start = a;
        end = b;
      } else {
        start = Number(base);
        end = stepText === undefined ? start : max;
      }
    }
    const values = sunday && value === 0 ? [0, 7] : [value];
    return (
      start >= min &&
      end <= max &&
      values.some(
        (candidate) => candidate >= start && candidate <= end && (candidate - start) % step === 0,
      )
    );
  });
}

export function isValidCron(expression: string): boolean {
  if (expression.trim().split(/\s+/).length !== 5) return false;
  const [minute, hour, day, month, weekday] = expression.trim().split(/\s+/);
  const fields: Array<[string | undefined, number, number]> = [
    [minute, 0, 59],
    [hour, 0, 23],
    [day, 1, 31],
    [month, 1, 12],
    [weekday, 0, 7],
  ];
  return (
    Boolean(minute && hour && day && month && weekday) &&
    fields.every(([field, min, max]) =>
      String(field)
        .split(",")
        .every((part) => {
          const [base, step, extra] = part.split("/");
          if (!part || extra !== undefined) return false;
          if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) return false;
          if (base === "*") return true;
          if (!base) return false;
          const bounds = base.split("-");
          if (bounds.length === 1)
            return /^\d+$/.test(base) && Number(base) >= Number(min) && Number(base) <= Number(max);
          if (bounds.length !== 2) return false;
          const [startText, endText] = bounds;
          if (!startText || !endText || !/^\d+$/.test(startText) || !/^\d+$/.test(endText))
            return false;
          const start = Number(startText);
          const end = Number(endText);
          return start <= end && start >= Number(min) && end <= Number(max);
        }),
    )
  );
}

export function matchesCron(expression: string, date: Date): boolean {
  if (!isValidCron(expression)) return false;
  const [minute, hour, day, month, weekday] = expression.trim().split(/\s+/) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const dom = fieldMatches(day, date.getDate(), 1, 31);
  const dow = fieldMatches(weekday, date.getDay(), 0, 7, true);
  const dayMatch = day === "*" ? dow : weekday === "*" ? dom : dom || dow;
  return (
    fieldMatches(minute, date.getMinutes(), 0, 59) &&
    fieldMatches(hour, date.getHours(), 0, 23) &&
    fieldMatches(month, date.getMonth() + 1, 1, 12) &&
    dayMatch
  );
}

/** Return the next matching local-time minute within one year, or null if none exists. */
export function nextCronOccurrence(expression: string, after = new Date()): Date | null {
  if (!isValidCron(expression)) return null;
  const [minute, hour, day, month, weekday] = expression.trim().split(/\s+/) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const minutes = Array.from({ length: 60 }, (_, value) => value).filter((value) =>
    fieldMatches(minute, value, 0, 59),
  );
  const hours = Array.from({ length: 24 }, (_, value) => value).filter((value) =>
    fieldMatches(hour, value, 0, 23),
  );
  const start = new Date(after);
  start.setSeconds(0, 0);
  if (start <= after) start.setMinutes(start.getMinutes() + 1);
  const startOfDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let offset = 0; offset <= 366; offset += 1) {
    const date = new Date(startOfDay);
    date.setDate(date.getDate() + offset);
    const dom = fieldMatches(day, date.getDate(), 1, 31);
    const dow = fieldMatches(weekday, date.getDay(), 0, 7, true);
    const dayMatch = day === "*" ? dow : weekday === "*" ? dom : dom || dow;
    if (!fieldMatches(month, date.getMonth() + 1, 1, 12) || !dayMatch) continue;
    for (const hourValue of hours) {
      for (const minuteValue of minutes) {
        const candidate = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          hourValue,
          minuteValue,
        );
        if (candidate.getHours() !== hourValue || candidate.getMinutes() !== minuteValue) continue;
        if (candidate >= start && candidate > after) return candidate;
      }
    }
  }
  return null;
}
