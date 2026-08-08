-- Fixes a genuine bug found by the local RLS test suite: jobs_admin_update
-- allowed an admin to change jobs.status, but jobs_select_active
-- (status = 'active' only) is the ONLY select-scoped visibility policy
-- on this table. PostgreSQL requires the row resulting from an UPDATE to
-- remain visible under the table's SELECT policies, not merely satisfy
-- the UPDATE policy's own WITH CHECK — so an admin closing a job (status
-- 'active' -> 'closed') made the resulting row invisible to themselves
-- mid-statement, and Postgres correctly rejected the whole UPDATE with
-- "new row violates row-level security policy for table jobs".
--
-- The fix is also the right product behavior, not just a technical
-- workaround: an admin managing jobs needs to see closed/expired rows too
-- (to review, reopen, or otherwise manage them), not only active ones.
-- This is a second PERMISSIVE select policy — combined with
-- jobs_select_active via OR, so ordinary users are unaffected (they still
-- see only status = 'active') and admins additionally see every job
-- regardless of status.
create policy "jobs_select_admin"
  on public.jobs
  for select
  to authenticated
  using (public.is_admin());
