-- Automatically creates a profiles row whenever a new Supabase Auth user
-- signs up, so the application never has to (and never gets a chance to)
-- insert a profile row under an arbitrary id from client code.
--
-- security definer is required here: this function must insert into
-- public.profiles even though there is no "insert" RLS policy for the
-- authenticated role on that table (see create_profiles migration). It
-- runs as its owner, not as the signing-up user, which is what allows it
-- to bypass RLS for this one controlled insert path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
