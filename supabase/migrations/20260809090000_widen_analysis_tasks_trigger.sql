-- Widens analysis_tasks.trigger to allow 'cv_replaced', needed by the new
-- replace_cv() RPC (20260809090010) so a post-onboarding CV replacement
-- can enqueue its own reprocessing task distinctly from the existing
-- 'onboarding_completed' trigger. Purely additive — every existing row and
-- caller (create_analysis_task's only current caller,
-- /api/onboarding/complete) is unaffected.
alter table public.analysis_tasks
  drop constraint analysis_tasks_trigger_check;

alter table public.analysis_tasks
  add constraint analysis_tasks_trigger_check
  check (trigger in ('onboarding_completed', 'cv_replaced'));
