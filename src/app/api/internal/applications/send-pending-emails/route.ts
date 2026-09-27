import { NextResponse } from "next/server";
import { parseSendPendingEmailsRequestBody } from "./parseSendPendingEmailsRequest";
import { findPendingEmailApplicationIds } from "@/lib/applications/findPendingApplications";
import { attemptSendApplicationEmail } from "@/lib/applications/sendApplication";
import { MockEmailTransport } from "@/lib/applications/emailTransport";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: attempts to send every currently
// pending_send email application.
//
// SAFETY (do not remove without a real, explicitly-approved provider
// integration): this endpoint ALWAYS uses MockEmailTransport. No real email
// provider is implemented anywhere in this codebase — there is no
// credential, no flag, and no code path that could cause a real external
// send here. See docs/OVERNIGHT_CREDENTIALS_REQUIRED.md for what a real
// integration needs before this could ever change, and AGENTS.md §7
// ("nothing may be sent... without explicit user approval") for why that
// change must never be made unilaterally.
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "APPLICATION_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseSendPendingEmailsRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = createAdminClient();
  const transport = new MockEmailTransport();
  const counts = { sent: 0, already_claimed: 0, not_email_method: 0, send_failed: 0 };

  try {
    const applicationIds = await findPendingEmailApplicationIds(supabase, parsed.value.limit);
    for (const applicationId of applicationIds) {
      const outcome = await attemptSendApplicationEmail(supabase, applicationId, transport);
      counts[outcome]++;
    }
  } catch (error) {
    console.error("send-pending-emails failed partway through:", error);
    return NextResponse.json({ error: "Failed to send pending applications. See server logs.", ...counts }, { status: 500 });
  }

  return NextResponse.json({ ...counts, transport: "mock" });
}
