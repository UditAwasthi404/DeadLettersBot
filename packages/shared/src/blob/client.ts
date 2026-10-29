/**
 * S3-compatible blob store (MinIO locally). Buckets from ARCHITECTURE.md §4:
 * conversation-blobs/, summary-archives/.
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const BUCKETS = {
  conversationBlobs: "conversation-blobs",
  summaryArchives: "summary-archives",
} as const;

export type BlobBucket = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface BlobStoreConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export function blobConfigFromEnv(): BlobStoreConfig {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("S3_ENDPOINT, S3_ACCESS_KEY, and S3_SECRET_KEY are required");
  }
  return {
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  };
}

export class BlobStore {
  readonly client: S3Client;

  constructor(config: BlobStoreConfig = blobConfigFromEnv()) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    });
  }

  /** Ensure Phase-1 buckets exist (idempotent). */
  async ensureBuckets(): Promise<void> {
    for (const bucket of Object.values(BUCKETS)) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    }
  }

  /** conversation-blobs/{accountId}/{botId}/{turnId}/root.bin */
  conversationKey(accountId: string, botId: string, turnId: string, name = "root.bin"): string {
    return `${accountId}/${botId}/${turnId}/${name}`;
  }

  async put(
    bucket: BlobBucket,
    key: string,
    body: Uint8Array | Buffer | string,
    contentType = "application/octet-stream",
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(bucket: BlobBucket, key: string): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!out.Body) return null;
      const bytes = await out.Body.transformToByteArray();
      return bytes;
    } catch (err) {
      const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw err;
    }
  }
}
