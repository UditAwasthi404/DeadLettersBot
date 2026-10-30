import { describe, expect, test } from "bun:test";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentBytesMatch,
  attachmentKey,
  validateAttachmentList,
} from "./attachments.ts";

const accountId = "11111111-1111-1111-1111-111111111111";
const id = "22222222-2222-2222-2222-222222222222";

describe("attachment limits", () => {
  test("accepts a stored file and rejects oversized or foreign URIs", () => {
    const file = {
      id,
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      uri: attachmentKey(accountId, id),
    };
    expect(validateAttachmentList(accountId, [file])).toBeNull();
    expect(attachmentBytesMatch(4, new Uint8Array(4))).toBe(true);
    expect(attachmentBytesMatch(4, new Uint8Array(3))).toBe(false);
    expect(
      validateAttachmentList(accountId, [{ ...file, sizeBytes: MAX_ATTACHMENT_BYTES + 1 }]),
    ).toBe("an attachment exceeds 10 MB");
    const second = "33333333-3333-3333-3333-333333333333";
    const third = "44444444-4444-4444-4444-444444444444";
    expect(
      validateAttachmentList(accountId, [
        { ...file, sizeBytes: MAX_ATTACHMENT_BYTES },
        {
          ...file,
          id: second,
          sizeBytes: MAX_ATTACHMENT_BYTES,
          uri: attachmentKey(accountId, second),
        },
        {
          ...file,
          id: third,
          sizeBytes: MAX_ATTACHMENT_BYTES,
          uri: attachmentKey(accountId, third),
        },
      ]),
    ).toBe("attachments exceed 25 MB");
    expect(validateAttachmentList(accountId, [{ ...file, uri: "data:text/plain,hi" }])).toBe(
      "attachment was not stored for this account",
    );
  });
});
