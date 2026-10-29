import net from "node:net";
import { Client } from "ssh2";
import { fingerprintOf } from "./sftp.js";
import type { S3Secret, SftpSecret } from "./types.js";
import type { S3DestinationSettings, SftpDestinationSettings } from "@nebuladb/shared";

/**
 * The throwaway MinIO and SFTP containers of `docker-compose.test.yml`, shared
 * by the backup destination tests. Kept out of the `.test.ts` files so `node
 * --test` does not pick it up as a test. Ports and credentials match the
 * compose file; override through the environment for a differently-set-up
 * instance.
 */
export const REMOTE_HINT =
  "start them with `docker compose -f docker-compose.test.yml up -d nebuladb-test-minio nebuladb-test-sftp` from the repo root, then re-run the tests";

export const MINIO = {
  host: process.env.NEBULADB_TEST_S3_HOST || "127.0.0.1",
  port: Number(process.env.NEBULADB_TEST_S3_PORT || 59000),
  secret: {
    accessKeyId: process.env.NEBULADB_TEST_S3_KEY || "nebuladb_test",
    secretAccessKey: process.env.NEBULADB_TEST_S3_SECRET || "nebuladb_test_secret",
  } satisfies S3Secret,
  settings(bucket: string, prefix = ""): S3DestinationSettings {
    return { endpoint: `http://${this.host}:${this.port}`, region: "us-east-1", bucket, prefix, pathStyle: true };
  },
};

export const SFTP = {
  host: process.env.NEBULADB_TEST_SFTP_HOST || "127.0.0.1",
  port: Number(process.env.NEBULADB_TEST_SFTP_PORT || 52222),
  username: process.env.NEBULADB_TEST_SFTP_USER || "nebuladb_test",
  secret: { password: process.env.NEBULADB_TEST_SFTP_PASSWORD || "nebuladb_test_pw" } satisfies SftpSecret,
  /** The one folder the container's user may write to. */
  remoteDir: "/upload",
  settings(hostKeyFingerprint: string, remoteDir = "/upload"): SftpDestinationSettings {
    return { host: this.host, port: this.port, username: this.username, remoteDir, hostKeyFingerprint };
  },
};

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

export const minioReachable = () => reachable(MINIO.host, MINIO.port);

/**
 * The fingerprint of the test SFTP server's host key — read by connecting and
 * refusing, which is how a person would fetch it (`ssh-keyscan`). `null` when
 * nothing answers.
 */
export async function sftpHostKey(): Promise<string | null> {
  if (!(await reachable(SFTP.host, SFTP.port))) return null;
  return new Promise((resolve) => {
    const client = new Client();
    let seen: string | null = null;
    client.once("error", () => resolve(seen));
    client.once("close", () => resolve(seen));
    client.connect({
      host: SFTP.host,
      port: SFTP.port,
      username: SFTP.username,
      password: SFTP.secret.password,
      readyTimeout: 5000,
      hostVerifier: (key: Buffer) => {
        seen = fingerprintOf(key);
        return false;
      },
    });
  });
}

/** A fingerprint no server has. */
export const WRONG_FINGERPRINT = `SHA256:${"A".repeat(43)}`;
