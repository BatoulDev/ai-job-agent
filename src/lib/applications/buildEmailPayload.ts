// Builds the real email payload a send attempt would transmit (Phase 09).
// Runs server-side only (admin/service_role client — this is trusted worker
// code, same trust level as embedJob.ts/saveMatch.ts). Fetches the CV's
// bytes from private Storage to prove the real attachment pipeline works
// end to end, but only ever passes metadata (filename/contentType/size) into
// the returned payload — the raw bytes are used transiently to measure size
// and are never logged, persisted, or returned (AGENTS.md §29: CV contents
// must never reach logs/analytics; §19: no CV data in audit metadata).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailPayload } from "./emailTransport.ts";

export interface BuildEmailPayloadInput {
  applicationId: string;
  matchId: string;
  jobId: string;
  coverLetterId: string | null;
}

export async function buildApplicationEmailPayload(supabase: SupabaseClient, input: BuildEmailPayloadInput): Promise<EmailPayload> {
  const { data: match, error: matchError } = await supabase.from("matches").select("user_id, cv_analysis_id").eq("id", input.matchId).maybeSingle();
  if (matchError) throw new Error(`buildApplicationEmailPayload: match lookup failed: ${matchError.message}`);
  if (!match) throw new Error(`buildApplicationEmailPayload: match ${input.matchId} not found`);

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("title, company_name, application_method, application_email")
    .eq("id", input.jobId)
    .maybeSingle();
  if (jobError) throw new Error(`buildApplicationEmailPayload: job lookup failed: ${jobError.message}`);
  if (!job) throw new Error(`buildApplicationEmailPayload: job ${input.jobId} not found`);
  if (job.application_method !== "email" || !job.application_email) {
    throw new Error("buildApplicationEmailPayload: job does not support email application");
  }

  if (!input.coverLetterId) {
    throw new Error("buildApplicationEmailPayload: application has no cover_letter_id");
  }
  const { data: coverLetter, error: coverLetterError } = await supabase
    .from("cover_letters")
    .select("approval_status, approved_content")
    .eq("id", input.coverLetterId)
    .maybeSingle();
  if (coverLetterError) throw new Error(`buildApplicationEmailPayload: cover letter lookup failed: ${coverLetterError.message}`);
  if (!coverLetter || coverLetter.approval_status !== "user_approved" || !coverLetter.approved_content) {
    throw new Error("buildApplicationEmailPayload: cover letter is not approved");
  }

  const { data: analysis, error: analysisError } = await supabase.from("cv_analyses").select("cv_id").eq("id", match.cv_analysis_id).maybeSingle();
  if (analysisError) throw new Error(`buildApplicationEmailPayload: analysis lookup failed: ${analysisError.message}`);
  if (!analysis) throw new Error("buildApplicationEmailPayload: analysis not found for this match");

  const { data: cv, error: cvError } = await supabase.from("cvs").select("storage_path, file_name, mime_type").eq("id", analysis.cv_id).maybeSingle();
  if (cvError) throw new Error(`buildApplicationEmailPayload: cv lookup failed: ${cvError.message}`);
  if (!cv) throw new Error("buildApplicationEmailPayload: cv not found for this analysis");

  const { data: fileBlob, error: downloadError } = await supabase.storage.from("cvs").download(cv.storage_path);
  if (downloadError) throw new Error(`buildApplicationEmailPayload: cv download failed: ${downloadError.message}`);
  const sizeBytes = fileBlob.size;

  return {
    to: job.application_email,
    subject: `Application for ${job.title} at ${job.company_name}`,
    body: coverLetter.approved_content,
    attachments: [{ filename: cv.file_name, contentType: cv.mime_type, sizeBytes }],
  };
}
