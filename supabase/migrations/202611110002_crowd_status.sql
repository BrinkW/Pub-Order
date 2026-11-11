-- A single staff-observed crowd level. Everyone may read it; only kitchen staff can update it.

create table public.crowd_status (
  id boolean primary key default true check (id),
  level text not null default 'not_reported'
    check (level in ('not_reported', 'low', 'moderate', 'busy')),
  updated_at timestamptz
);

insert into public.crowd_status (id, level) values (true, 'not_reported');

alter table public.crowd_status enable row level security;
create policy "Anyone reads crowd status" on public.crowd_status
  for select to anon, authenticated using (true);
revoke all on public.crowd_status from public, anon, authenticated;
grant select on public.crowd_status to anon, authenticated;

create or replace function public.set_crowd_level(p_level text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_kitchen() then
    raise exception 'set_crowd_level: kitchen access required' using errcode = '42501';
  end if;
  if p_level is null or p_level not in ('low', 'moderate', 'busy') then
    raise exception 'set_crowd_level: unknown level' using errcode = '22023';
  end if;
  update public.crowd_status
  set level = p_level, updated_at = now()
  where id = true;
end;
$$;

revoke all on function public.set_crowd_level(text) from public, anon;
grant execute on function public.set_crowd_level(text) to authenticated;
