// The one extension point for real outbound email delivery (Phase 09).
// SAFETY: no real transport is implemented in this codebase yet. There is no
// env flag that flips this on — the capability to actually transmit an email
// to an external address does not exist here at all, which is a stronger
// guarantee than a flag defaulting to false (a misconfigured flag can't turn
// on something that was never written). See
// docs/OVERNIGHT_CREDENTIALS_REQUIRED.md for what a real integration
// (e.g. Resend/SendGrid/SES) needs before this could ever be wired in.
import { randomUUID } from "node:crypto";

export interface EmailAttachmentMeta {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  attachments: EmailAttachmentMeta[];
}

export interface EmailSendResult {
  providerMessageId: string;
}

export interface EmailTransport {
  send(payload: EmailPayload): Promise<EmailSendResult>;
}

/** Never makes a network call. Records nothing anywhere on its own — callers decide what, if anything, to persist about a mock send. */
export class MockEmailTransport implements EmailTransport {
  public readonly sentPayloads: EmailPayload[] = [];

  async send(payload: EmailPayload): Promise<EmailSendResult> {
    this.sentPayloads.push(payload);
    return { providerMessageId: `mock-${randomUUID()}` };
  }
}
