import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { BackupConfig } from "../lib/backup";

export type BackupObject = { key: string; bytes: number; lastModified: Date };

/** Where backup files live. The S3 implementation talks to Cloudflare R2 (or the local fake). */
export interface BackupStore {
  put(key: string, file: string, bytes: number, sha256: string): Promise<void>;
  head(key: string): Promise<{ bytes: number } | null>;
  list(prefix: string): Promise<BackupObject[]>;
  get(key: string, destination: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createS3BackupStore(s3: BackupConfig["s3"]): BackupStore {
  const client = new S3Client({
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: Boolean(s3.endpoint),
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = s3.bucket;
  return {
    async put(key, file, bytes, sha256) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: createReadStream(file),
          ContentLength: bytes,
          ContentType: "application/octet-stream",
          Metadata: { sha256 },
        }),
      );
    },
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { bytes: out.ContentLength ?? 0 };
      } catch (error) {
        const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)
          return null;
        throw error;
      }
    },
    async list(prefix) {
      const objects: BackupObject[] = [];
      let token: string | undefined;
      do {
        const out = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of out.Contents ?? []) {
          if (o.Key && o.LastModified)
            objects.push({ key: o.Key, bytes: o.Size ?? 0, lastModified: o.LastModified });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },
    async get(key, destination) {
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!out.Body) throw new Error(`empty body for ${key}`);
      await pipeline(out.Body as Readable, createWriteStream(destination));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
