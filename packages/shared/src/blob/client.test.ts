import { describe, expect, test } from "bun:test";
import { BUCKETS, BlobStore } from "./client.ts";

describe("BlobStore", () => {
  test("conversationKey matches ARCHITECTURE layout", () => {
    const store = new BlobStore({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      accessKeyId: "minio",
      secretAccessKey: "minio123",
    });
    expect(store.conversationKey("a", "b", "t")).toBe("a/b/t/root.bin");
    expect(BUCKETS.conversationBlobs).toBe("conversation-blobs");
    expect(BUCKETS.summaryArchives).toBe("summary-archives");
  });
});
