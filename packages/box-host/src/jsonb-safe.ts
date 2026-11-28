/** Postgres jsonb rejects `\u0000`. Strip nulls before any jsonb write. */

export function stripNullBytes(value: string): string {
  return value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
}

export function sanitizeForJsonb<T>(value: T): T {
  if (typeof value === "string") return stripNullBytes(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeForJsonb(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeForJsonb(child);
    }
    return out as T;
  }
  return value;
}

/** Decode text attachments; UTF-16 files otherwise inject null bytes into history. */
export function decodeTextAttachment(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return stripNullBytes(new TextDecoder("utf-16le").decode(bytes));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return stripNullBytes(new TextDecoder("utf-16be").decode(bytes));
  }
  // UTF-16LE without BOM: high null density on odd indices.
  if (bytes.length >= 8) {
    let oddNulls = 0;
    const sample = Math.min(bytes.length, 64);
    for (let i = 1; i < sample; i += 2) if (bytes[i] === 0) oddNulls += 1;
    if (oddNulls >= sample / 4) {
      return stripNullBytes(new TextDecoder("utf-16le").decode(bytes));
    }
  }
  return stripNullBytes(new TextDecoder().decode(bytes));
}
