import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * The private DigitalOcean Spaces bucket the backups go to, or null when
 * SPACES_* are not set (local development: backups then stay on disk).
 *
 * This app's key and bucket (or folder) are its own — never Lindero's or
 * Báscula Central's — so one app can be restored without touching the others.
 */
export interface Spaces {
  bucket: string;
  prefix: string;
  upload: (file: string, key: string) => Promise<void>;
  copy: (fromKey: string, toKey: string) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
  remove: (key: string) => Promise<void>;
  download: (key: string, file: string) => Promise<void>;
}

export function spacesFromEnv(env: NodeJS.ProcessEnv = process.env): Spaces | null {
  const { SPACES_ENDPOINT, SPACES_REGION, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET } = env;
  if (!SPACES_ENDPOINT || !SPACES_BUCKET || !SPACES_KEY || !SPACES_SECRET) {
    return null;
  }

  const client = new S3Client({
    endpoint: SPACES_ENDPOINT,
    region: SPACES_REGION || "us-east-1",
    credentials: { accessKeyId: SPACES_KEY, secretAccessKey: SPACES_SECRET },
  });
  const bucket = SPACES_BUCKET;

  return {
    bucket,
    prefix: (env.SPACES_PREFIX ?? "zoilabe/backups").replace(/\/+$/, ""),
    upload: async (file, key) => {
      const { size } = await stat(file);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(file),
          ContentLength: size,
          ACL: "private",
        }),
      );
    },
    copy: async (fromKey, toKey) => {
      await client.send(
        new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${fromKey}`, Key: toKey, ACL: "private" }),
      );
    },
    list: async (prefix) => {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const object of page.Contents ?? []) {
          if (object.Key) keys.push(object.Key);
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    remove: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    download: async (key, file) => {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      await pipeline(object.Body as Readable, createWriteStream(file));
    },
  };
}
