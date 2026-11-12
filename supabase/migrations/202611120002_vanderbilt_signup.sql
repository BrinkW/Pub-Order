-- SEC-02: only @vanderbilt.edu addresses can create an account.
-- Sign-up goes from the browser straight to Supabase Auth, never through our backend, so
-- the check has to live in the database: this trigger refuses to create an account with any
-- other address, or to change an account's address to one. Existing accounts are untouched.
-- Email confirmation (proving the student owns the address) is a project setting, not SQL:
-- Authentication -> Sign In / Providers -> Email -> Confirm email.
-- Safe to run again: the function is replaced and the trigger recreated.

create or replace function public.require_vanderbilt_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;
  if new.email is null or lower(new.email) !~ '^[^@[:space:]]+@vanderbilt\.edu$' then
    raise exception 'Sign up with a Vanderbilt email address.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.require_vanderbilt_email() from public, anon, authenticated;

drop trigger if exists require_vanderbilt_email on auth.users;
create trigger require_vanderbilt_email
  before insert or update of email on auth.users
  for each row execute function public.require_vanderbilt_email();
