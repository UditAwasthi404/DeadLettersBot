/** Raised when checkpoint/blob settle succeeded but transcript mirror failed (REQ-H19). */

export class TranscriptAppendAfterCheckpointError extends Error {
  override readonly name = "TranscriptAppendAfterCheckpointError";
}
