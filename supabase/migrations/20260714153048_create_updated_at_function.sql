



-- Shared trigger function that stamps updated_at on every row update.
-- Used by profiles, job_preferences, and cvs so none of them trust a
-- client-supplied updated_at value.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
