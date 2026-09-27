// Pure "Prepare Application" preview builder (Phase 09). No network, no DB —
// derives exactly what create_application()/the send worker would use, from
// data the caller already has (job + approved cover letter), so a user can
// review before the explicit Approve & Send gate. Never invents content:
// the email body is the user's own already-approved cover letter, verbatim;
// the subject is a deterministic template, not an LLM call (AGENTS.md §30 —
// no AI call is needed or wanted for a subject line).

export interface ApplicationPreviewJobInput {
  title: string;
  companyName: string;
  applicationMethod: "external_link" | "email";
  applicationUrl: string | null;
  applicationEmail: string | null;
}

export interface ApplicationPreviewCoverLetterInput {
  approvalStatus: "draft" | "user_approved";
  approvedContent: string | null;
}

// `blocked` is a required literal on every member (rather than an optional
// flag only some variants carry) so callers get clean discriminated-union
// narrowing via `preview.blocked` alone, with no `in` checks needed.
export type ApplicationPreview =
  | { method: "external_link"; blocked: false; applyUrl: string }
  | { method: "email"; blocked: false; recipientEmail: string; subject: string; body: string }
  | { method: "email"; blocked: true; reason: string };

export function buildApplicationPreview(
  job: ApplicationPreviewJobInput,
  coverLetter: ApplicationPreviewCoverLetterInput | null
): ApplicationPreview {
  if (job.applicationMethod === "external_link") {
    if (!job.applicationUrl) {
      throw new Error("External-link job is missing an application_url — this indicates a data problem, not a user error.");
    }
    return { method: "external_link", blocked: false, applyUrl: job.applicationUrl };
  }

  if (!job.applicationEmail) {
    return { method: "email", blocked: true, reason: "This job has no application email on file." };
  }
  if (!coverLetter || coverLetter.approvalStatus !== "user_approved" || !coverLetter.approvedContent) {
    return { method: "email", blocked: true, reason: "Approve your cover letter before previewing this email application." };
  }

  return {
    method: "email",
    blocked: false,
    recipientEmail: job.applicationEmail,
    subject: `Application for ${job.title} at ${job.companyName}`,
    body: coverLetter.approvedContent,
  };
}
