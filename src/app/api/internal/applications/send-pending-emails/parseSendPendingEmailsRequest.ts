// Pure request-body validation for POST /api/internal/applications/send-pending-emails.
// Same convention as every other internal endpoint's parse module.

const MAX_LIMIT = 200;

export interface SendPendingEmailsRequestBody {
  limit: number;
}

export type ParseSendPendingEmailsRequestResult = { ok: true; value: SendPendingEmailsRequestBody } | { ok: false; error: string };

export function parseSendPendingEmailsRequestBody(body: unknown): ParseSendPendingEmailsRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (typeof record.limit !== "number" || !Number.isInteger(record.limit) || record.limit < 1 || record.limit > MAX_LIMIT) {
    return { ok: false, error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
  }

  return { ok: true, value: { limit: record.limit } };
}
