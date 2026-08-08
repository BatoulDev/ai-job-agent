-- Evidence-based indexes only — each below supports either an existing
-- RLS-filtered query pattern already present elsewhere in this schema, or
-- an access pattern explicitly named in AI_JOB_AGENT_SYSTEM_AUDIT.md
-- Section 12/17. None are speculative.

-- Audit Section 12, Item 10 (P2): every other user-owned table already has
-- a plain index backing its "select own" RLS policy (cv_analyses.user_id,
-- payment_attempts.user_id, job_preferences.user_id via its unique index)
-- except analysis_tasks — cheap, low-write-cost, closes the one
-- inconsistency the audit found.
create index analysis_tasks_user_id_idx on public.analysis_tasks (user_id);

-- matches: audit Section 12 explicitly names "match lookup by user+status"
-- and "match lookup by user ordered by score/date" as required MVP
-- patterns; matches_select_own filters by user_id with no supporting index
-- today (matches_user_job_analysis_key's leading column is user_id, but a
-- 3-column unique index is not interchangeable with a lookup that also
-- needs to sort by score/date).
create index matches_user_status_idx on public.matches (user_id, status);
create index matches_user_score_idx on public.matches (user_id, score desc, created_at desc);

-- cover_letters_select_own filters by user_id; cover_letters_match_id_key
-- only supports lookup by match, not by user.
create index cover_letters_user_id_idx on public.cover_letters (user_id);
