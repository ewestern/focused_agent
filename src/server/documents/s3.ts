import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { DocumentStore, PutDocument } from "@/server/documents/store";
import { getServerEnv, type ServerEnv } from "@/server/env";

export class S3DocumentStore implements DocumentStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(document: PutDocument): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: document.key,
        Body: document.body,
        ContentType: document.contentType,
        Metadata: { sha256: document.sha256 },
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) {
      throw new Error(`Document ${key} had no response body.`);
    }
    return result.Body.transformToByteArray();
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async ensureReady(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (error instanceof NotFound) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchBucket" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export function createS3DocumentStore(
  env: ServerEnv = getServerEnv(),
): S3DocumentStore {
  return new S3DocumentStore(
    new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
    env.S3_BUCKET,
  );
}

let sharedStore: S3DocumentStore | undefined;

export function getDocumentStore(): S3DocumentStore {
  sharedStore ??= createS3DocumentStore();
  return sharedStore;
}
