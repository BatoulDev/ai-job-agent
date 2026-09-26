// Pure vector math for the matching shortlist (Phase 05). No pgvector
// extension — see the migration comment in
// supabase/migrations/20260927090000_add_matching_embeddings.sql for why
// in-process cosine similarity over a bounded candidate set is the right
// size of solution today.

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
