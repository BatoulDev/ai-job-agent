// Client-side only — called from the CV Profile approval dialog.
// Do not import from Server Components or API routes.
import type { CvAnalysis } from "./types";

export interface ConfirmAnalysisResult {
  ok: boolean;
  message?: string;
  analysis?: CvAnalysis;
}

// Calls POST /api/cv-analysis/confirm with the given analysisId.
// Returns the updated CvAnalysis on success, or a safe error message on failure.
// Non-2xx responses surface the server's error field; network failures return a
// generic "could not reach server" message so no internal detail leaks to the UI.
export async function confirmCvAnalysisRequest(
  analysisId: string
): Promise<ConfirmAnalysisResult> {
  let response: Response;
  try {
    response = await fetch("/api/cv-analysis/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysisId }),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Please try again." };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, message: "Unexpected response from server." };
  }

  if (!response.ok) {
    const errMsg =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Something went wrong. Please try again.";
    return { ok: false, message: errMsg };
  }

  if (typeof data !== "object" || data === null || !("analysis" in data)) {
    return { ok: false, message: "Unexpected response from server." };
  }

  return { ok: true, analysis: (data as { analysis: CvAnalysis }).analysis };
}
