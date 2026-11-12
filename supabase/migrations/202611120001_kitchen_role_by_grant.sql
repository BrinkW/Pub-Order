-- SEC-01: kitchen access is never granted by email address.
-- Before this, registering kitchen@puborder.test made the new account kitchen staff, so on
-- any project where that account didn't exist yet, whoever registered it first got staff access.
-- Now every new account is a student. Kitchen access is granted only by a database change
-- that someone with project access makes on purpose, for example in the SQL editor:
--   update public.profiles set role = 'kitchen'
--   where user_id = (select id from auth.users where email = '<staff email>');
-- Existing profiles keep their role, so an existing kitchen account still works.
-- Safe to run again: the function is replaced.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, role)
  values (new.id, 'student')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
