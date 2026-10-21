import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { S3DestinationSettings } from "@nebuladb/shared";
import { assertHostAllowed, guardedLookup } from "../../connections/hostGuard.js";
import { ObjectMissingError, type BackupStore, type S3Secret } from "./types.js";

const PART_SIZE = 8 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 5 * 60_000;

/** `a/b` → `a/b/`; empty stays empty. */
export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
}

/** What an S3 call failed with, in the remote's words (`AccessDenied: …`) — the SDK's message alone is sometimes just "UnknownError". */
export function s3Reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const status = err instanceof S3ServiceException ? err.$metadata?.httpStatusCode : undefined;
  const code = (err as { code?: string }).code;
  const generic = !err.message || err.message === "UnknownError" || err.message === err.name;
  if (!generic) return err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message;
  const detail = status ? `HTTP ${status}` : code;
  return detail ? `${err.name}: ${detail}` : err.name || err.message;
}

/**
 * An S3-compatible bucket. Uploads go through `@aws-sdk/lib-storage`'s
 * multipart upload — a stream of unknown length, a few parts in memory at a
 * time. Every connection the SDK opens goes through the metadata-endpoint
 * check at connect time (`guardedLookup`), so a name that resolves there later
 * is refused too.
 */
export class S3Store implements BackupStore {
  readonly kind = "s3" as const;
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(
    private readonly settings: S3DestinationSettings,
    secret: S3Secret,
  ) {
    this.prefix = normalizePrefix(settings.prefix);
    this.client = new S3Client({
      region: settings.region,
      endpoint: settings.endpoint || undefined,
      forcePathStyle: settings.pathStyle,
      credentials: { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey },
      maxAttempts: 3,
      requestHandler: {
        connectionTimeout: CONNECT_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
        httpAgent: new http.Agent({ lookup: guardedLookup, keepAlive: true }),
        httpsAgent: new https.Agent({ lookup: guardedLookup, keepAlive: true }),
      },
    });
  }

  private key(name: string): string {
    return `${this.prefix}${name}`;
  }

  /** The endpoint's host, checked up front for a clear refusal; the connect-time lookup is what closes DNS rebinding. */
  private async checkEndpoint(): Promise<void> {
    if (this.settings.endpoint) await assertHostAllowed(new URL(this.settings.endpoint).hostname);
  }

  async write(name: string, source: Readable): Promise<void> {
    await this.checkEndpoint();
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.settings.bucket,
        Key: this.key(name),
        Body: source,
        ContentType: "application/octet-stream",
      },
      queueSize: 3,
      partSize: PART_SIZE,
      leavePartsOnError: false,
    });
    // A source that dies without the uploader noticing (a cancelled backup) must not leave the upload waiting.
    const onClose = () => {
      if (source.destroyed && !source.errored && !source.readableEnded) void upload.abort().catch(() => {});
    };
    source.once("close", onClose);
    try {
      await upload.done();
    } catch (err) {
      await upload.abort().catch(() => {});
      await this.delete(name).catch(() => {});
      throw err;
    } finally {
      source.off("close", onClose);
    }
  }

  async read(name: string): Promise<Readable> {
    await this.checkEndpoint();
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.settings.bucket, Key: this.key(name) }),
      );
      return response.Body as Readable;
    } catch (err) {
      // Only a missing key is "missing"; a missing bucket is the destination being wrong.
      if (err instanceof S3ServiceException && err.name === "NoSuchKey") throw new ObjectMissingError(name);
      throw err;
    }
  }

  async delete(name: string): Promise<void> {
    await this.checkEndpoint();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: this.key(name) }));
  }

  async probe(): Promise<void> {
    await this.checkEndpoint();
    const name = `.nebuladb-write-test-${crypto.randomUUID()}`;
    const body = crypto.randomBytes(16);
    await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: this.key(name), Body: body }));
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.settings.bucket, Key: this.key(name) }),
      );
      const back = Buffer.from(await response.Body!.transformToByteArray());
      if (!back.equals(body)) throw new Error("the probe object read back differently from what was written");
    } finally {
      await this.delete(name).catch(() => {});
    }
  }
}
