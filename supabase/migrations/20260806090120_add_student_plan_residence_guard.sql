-- Extends create_payment_attempt with the server-side guard required by
-- AGENTS.md §8/§10: Student is only available to Lebanon-based users, and
-- a manipulated client request (calling this RPC directly with
-- plan_code='student') must not be able to bypass that. If the caller's
-- country_of_residence is unknown (null), we cannot yet know they're
-- ineligible, so the attempt is still allowed — the UI-side notice (see
-- src/components/landing/Pricing.tsx) already only disables Student once a
-- known non-Lebanon residence is loaded.
--
-- Raises a distinct, matchable message (not a generic error) so the
-- checkout route/page can surface the real, honest reason instead of a
-- generic "something went wrong" (AGENTS.md §19 — distinguish validation
-- errors from unexpected errors).
create or replace function public.create_payment_attempt(p_plan_code text)
returns public.payment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.plans;
  v_country text;
  v_existing public.payment_attempts;
  v_row public.payment_attempts;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_plan
  from public.plans
  where plan_code = p_plan_code and is_active = true and plan_code <> 'free';

  if not found then
    raise exception 'Unknown or non-payable plan code: %', p_plan_code;
  end if;

  if p_plan_code = 'student' then
    select country_of_residence into v_country from public.profiles where id = v_user_id;

    if v_country is not null and v_country <> 'LB' then
      raise exception 'student_unavailable_outside_lebanon';
    end if;
  end if;

  select * into v_existing
  from public.payment_attempts
  where user_id = v_user_id
    and plan_code = p_plan_code
    and status in ('created', 'pending')
  order by created_at desc
  limit 1;

  if found then
    return v_existing;
  end if;

  insert into public.payment_attempts (user_id, plan_code, amount, currency, provider, status, idempotency_key)
  values (v_user_id, v_plan.plan_code, v_plan.price_amount, v_plan.currency, 'whish', 'created', gen_random_uuid()::text)
  returning * into v_row;

  return v_row;
end;
$$;
