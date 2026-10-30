import type { Attachment } from "@agentOS/shared";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PROMPT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function attachmentKey(accountId: string, id: string): string {
  return `${accountId}/attachments/${id}`;
}

export function attachmentBytesMatch(sizeBytes: number, stored: Uint8Array | null): boolean {
  return stored !== null && stored.byteLength === sizeBytes && sizeBytes <= MAX_ATTACHMENT_BYTES;
}

/** Returns an error message, or null when the metadata is safe to load. */
export function validateAttachmentList(
  accountId: string,
  attachments: Attachment[],
): string | null {
  if (!Array.isArray(attachments)) return "attachments must be a list";
  let total = 0;
  for (const attachment of attachments) {
    if (!/^[0-9a-f-]{36}$/i.test(attachment?.id ?? "")) return "attachment id is invalid";
    const name = attachment.name?.trim() ?? "";
    if (!name || name.length > 255 || name.includes("/") || name.includes("\\"))
      return "attachment name is invalid";
    if (!attachment.mimeType || attachment.mimeType.length > 127)
      return "attachment type is invalid";
    if (
      !Number.isInteger(attachment.sizeBytes) ||
      attachment.sizeBytes < 1 ||
      attachment.sizeBytes > MAX_ATTACHMENT_BYTES
    )
      return "an attachment exceeds 10 MB";
    total += attachment.sizeBytes;
    if (total > MAX_PROMPT_ATTACHMENT_BYTES) return "attachments exceed 25 MB";
    if (attachment.uri !== attachmentKey(accountId, attachment.id))
      return "attachment was not stored for this account";
  }
  return null;
}
