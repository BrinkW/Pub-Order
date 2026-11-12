-- US4 student notifications: publish order changes to Supabase Realtime, so a student's
-- browser hears about a status change (for example, Ready for pickup) without refreshing.
--
-- Realtime applies the same row-level security as a normal read: a subscriber only gets
-- changes for rows "Students read own orders" lets them select, so a student is never sent
-- another student's order. Kitchen staff already read every order through is_kitchen().
-- The block is idempotent and skips databases that have no supabase_realtime publication
-- (plain Postgres), where the app falls back to polling.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
     ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
