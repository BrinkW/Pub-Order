-- Store the authenticated student's email with each order so kitchen staff can send an
-- order-status notification without receiving access to Supabase Auth administration.

alter table public.orders add column student_email text;
alter table public.orders add constraint orders_student_email_length
  check (student_email is null or char_length(student_email) between 3 and 254);

-- Existing orders become notifiable when their Auth user still exists.
update public.orders o
set student_email = lower(u.email)
from auth.users u
where u.id = o.user_id and u.email is not null;

create or replace function public.capture_order_student_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(auth.jwt() ->> 'email'), '');
begin
  if new.student_email is null then
    new.student_email := v_email;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_order_student_email on public.orders;
create trigger capture_order_student_email
  before insert on public.orders
  for each row execute function public.capture_order_student_email();

revoke all on function public.capture_order_student_email() from public, anon, authenticated;
