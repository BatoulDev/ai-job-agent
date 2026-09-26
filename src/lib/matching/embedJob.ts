// DB-touching orchestration for one job's embedding (Phase 05). The actual
// embedding-provider call is injected (EmbeddingGenerator) rather than
// hardcoded to a specific vendor — no embeddings API key is available to
// this app yet (see docs/OVERNIGHT_CREDENTIALS_REQUIRED.md), so this module
// is built and tested against a fake generator now; wiring a real provider
// in later needs no change here, only a new EmbeddingGenerator
// implementation passed in by the caller.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildJobEmbeddingText, hashEmbeddingText, type JobEmbeddingInput } from "./embeddingText.ts";

/** Given the exact text to embed, returns its vector. Implemented by whichever provider is eventually wired up. */
export type EmbeddingGenerator = (text: string) => Promise<number[]>;

export type EmbedJobResult =
  | { updated: true; reason: "embedded" }
  | { updated: false; reason: "job_not_found" | "unchanged" };

/**
 * Re-embeds a job only when its embedding-relevant content has actually
 * changed since it was last embedded ("refresh only when relevant content
 * changes" — never on every ingestion run).
 */
export async function embedJobIfChanged(
  supabase: SupabaseClient,
  jobId: string,
  generateEmbedding: EmbeddingGenerator
): Promise<EmbedJobResult> {
  const { data: job, error } = await supabase
    .from("jobs")
    .select("title, description, company_name, location, work_arrangement, seniority, employment_type, embedding_content_hash")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`embedJobIfChanged: failed to read job ${jobId}: ${error.message}`);
  if (!job) return { updated: false, reason: "job_not_found" };

  const input: JobEmbeddingInput = {
    title: job.title,
    description: job.description,
    company_name: job.company_name,
    location: job.location,
    work_arrangement: job.work_arrangement,
    seniority: job.seniority,
    employment_type: job.employment_type,
  };
  const text = buildJobEmbeddingText(input);
  const hash = hashEmbeddingText(text);

  if (job.embedding_content_hash === hash) {
    return { updated: false, reason: "unchanged" };
  }

  const embedding = await generateEmbedding(text);

  const { error: updateError } = await supabase
    .from("jobs")
    .update({ embedding, embedding_content_hash: hash, embedding_generated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (updateError) throw new Error(`embedJobIfChanged: failed to persist embedding for ${jobId}: ${updateError.message}`);

  return { updated: true, reason: "embedded" };
}
