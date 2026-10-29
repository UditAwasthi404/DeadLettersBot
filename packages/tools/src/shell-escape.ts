/** Single-quote a path for `sh -c`; escape embedded single quotes. */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
