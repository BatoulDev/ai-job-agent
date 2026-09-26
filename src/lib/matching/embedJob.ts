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

// ── Two-step split for an external caller that owns the embedding-provider
// call itself (n8n, reusing its existing OpenAI credential — see
// docs/OVERNIGHT_BUILD_PROGRESS.md Phase 05's architecture decision).
// findJobsNeedingEmbedding() and saveJobEmbedding() below are what the new
// internal endpoints wrap; embedJobIfChanged() above remains valid for any
// future caller that already has its own EmbeddingGenerator in-process.

export interface PendingJobEmbedding {
  jobId: string;
  text: string;
  contentHash: string;
}

/**
 * Bounded discovery query: active jobs with no embedding yet. Deliberately
 * scoped to "never embedded" rather than also detecting later content
 * drift on an already-embedded job (which would need a cross-column
 * updated_at/embedding_generated_at comparison PostgREST cannot express
 * directly) — a documented MVP simplification, not an oversight. A caller
 * that already knows a specific job's content changed should call
 * embedJobIfChanged() directly instead.
 */
export async function findJobsNeedingEmbedding(supabase: SupabaseClient, limit: number): Promise<PendingJobEmbedding[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, title, description, company_name, location, work_arrangement, seniority, employment_type")
    .eq("status", "active")
    .is("embedding", null)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`findJobsNeedingEmbedding: query failed: ${error.message}`);

  return (data ?? []).map((job) => {
    const text = buildJobEmbeddingText({
      title: job.title,
      description: job.description,
      company_name: job.company_name,
      location: job.location,
      work_arrangement: job.work_arrangement,
      seniority: job.seniority,
      employment_type: job.employment_type,
    });
    return { jobId: job.id, text, contentHash: hashEmbeddingText(text) };
  });
}

/** Persists an embedding computed externally for a job already returned by findJobsNeedingEmbedding(). */
export async function saveJobEmbedding(supabase: SupabaseClient, jobId: string, embedding: number[], contentHash: string): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({ embedding, embedding_content_hash: contentHash, embedding_generated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(`saveJobEmbedding: failed to persist embedding for ${jobId}: ${error.message}`);
}
