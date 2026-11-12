-- US4 student notifications: run against a disposable database after applying the migrations
-- (CI: local Supabase). Order status changes are published to Supabase Realtime, so a student's
-- browser hears about them, and order items are not. Row-level security still decides who
-- receives each change. Read-only, so there is nothing to roll back.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
      raise exception 'Order changes must be published to Supabase Realtime';
    end if;
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items'
    ) then
      raise exception 'Order items should not be published to Supabase Realtime';
    end if;
  end if;
end $$;
