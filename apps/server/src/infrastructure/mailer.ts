import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

/**
 * The one way the server sends email. A thin wrapper over nodemailer so the
 * rest of the code never builds a transport itself, and so "email is off"
 * (`config.smtp === null`) is a single check here rather than a condition
 * sprinkled through every feature that might send something.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!config.smtp) throw new Error("email is not configured (ATHANORDB_SMTP_HOST is unset)");
  if (!transport) {
    const { host, port, secure, user, password } = config.smtp;
    transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: password ?? "" } : undefined,
      // A mail server that accepts the TCP connection and then says nothing
      // must not hold a request (or a background send) open indefinitely.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

export function isMailEnabled(): boolean {
  return config.smtp !== null;
}

/** Rejects if the SMTP server refuses the message — callers decide whether that's worth surfacing. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  await getTransport().sendMail({ from: config.smtp!.from, ...mail });
}

/** Absolute link into the app — `config.publicUrl` is guaranteed set whenever email is on (see `readSmtp`). */
export function appUrl(path: string): string {
  return `${config.publicUrl}${path}`;
}
