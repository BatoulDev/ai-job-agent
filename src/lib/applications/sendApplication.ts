// The real send-attempt pipeline for one email application (Phase 09).
// SAFETY: the transport passed in must be the caller's choice — this module
// never constructs its own transport, so it can never silently pick a real
// one. Every call site in this codebase passes MockEmailTransport; there is
// no real transport implementation to pass instead (see emailTransport.ts).
//
// Idempotency/concurrency: claims the row via an UPDATE ... WHERE
// status = 'pending_send' guard, so two concurrent callers can never both
// transition the same row to 'sending' — only one wins, the other treats it
// as already claimed. Terminal states (sent/failed/cancelled) are never
// re-attempted by this function; a genuine retry after 'failed' happens via
// a brand-new applications row (create_application()'s own documented
// retry-via-new-row design — see applications_one_active_per_match).
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildApplicationEmailPayload } from "./buildEmailPayload.ts";
import type { EmailTransport } from "./emailTransport.ts";

export type SendApplicationOutcome = "sent" | "already_claimed" | "not_email_method" | "send_failed";

async function recordAuditEvent(
  supabase: SupabaseClient,
  userId: string,
  eventType: "application_send_attempted" | "application_send_result",
  applicationId: string,
  metadata: Record<string, unknown>
) {
  await supabase.from("audit_events").insert({
    user_id: userId,
    actor_type: "system",
    event_type: eventType,
    entity_type: "application",
    entity_id: applicationId,
    metadata,
  });
}

export async function attemptSendApplicationEmail(
  supabase: SupabaseClient,
  applicationId: string,
  transport: EmailTransport
): Promise<SendApplicationOutcome> {
  const { data: current, error: readError } = await supabase
    .from("applications")
    .select("id, user_id, match_id, job_id, cover_letter_id, application_method, status, send_attempt_count")
    .eq("id", applicationId)
    .maybeSingle();
  if (readError) throw new Error(`attemptSendApplicationEmail: read failed: ${readError.message}`);
  if (!current) throw new Error(`attemptSendApplicationEmail: application ${applicationId} not found`);
  if (current.application_method !== "email") return "not_email_method";
  if (current.status !== "pending_send") return "already_claimed";

  const { data: claimed, error: claimError } = await supabase
    .from("applications")
    .update({ status: "sending", send_attempt_count: current.send_attempt_count + 1, last_attempt_at: new Date().toISOString() })
    .eq("id", applicationId)
    .eq("status", "pending_send")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(`attemptSendApplicationEmail: claim failed: ${claimError.message}`);
  if (!claimed) return "already_claimed"; // lost the race to a concurrent caller

  await recordAuditEvent(supabase, current.user_id, "application_send_attempted", applicationId, { method: "email" });

  try {
    const payload = await buildApplicationEmailPayload(supabase, {
      applicationId,
      matchId: current.match_id,
      jobId: current.job_id,
      coverLetterId: current.cover_letter_id,
    });
    const result = await transport.send(payload);

    const { error: sentError } = await supabase
      .from("applications")
      .update({ status: "sent", provider_message_id: result.providerMessageId, last_error: null })
      .eq("id", applicationId);
    if (sentError) throw new Error(sentError.message);

    await recordAuditEvent(supabase, current.user_id, "application_send_result", applicationId, { outcome: "sent" });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown send failure";
    await supabase.from("applications").update({ status: "failed", last_error: message }).eq("id", applicationId);
    await recordAuditEvent(supabase, current.user_id, "application_send_result", applicationId, { outcome: "failed" });
    return "send_failed";
  }
}
