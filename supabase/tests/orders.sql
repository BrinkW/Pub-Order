-- Run against a disposable database after applying the migrations (CI: local Supabase).
-- Everything runs in one transaction that is rolled back, so nothing is left behind.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'order-test-a@vanderbilt.edu'),
  ('00000000-0000-4000-8000-00000000000b', 'order-test-b@vanderbilt.edu');

-- Table constraints.
do $$
begin
  begin
    insert into public.orders (user_id, swipes, status, idempotency_key)
    values ('00000000-0000-4000-8000-00000000000a', 1, 'Lost', gen_random_uuid());
    raise exception 'An unknown order status was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.orders (user_id, swipes, idempotency_key)
    values ('00000000-0000-4000-8000-00000000000a', 11, gen_random_uuid());
    raise exception 'More than 10 swipes was accepted';
  exception when check_violation then null;
  end;
end $$;

-- Guests can neither read orders nor place them.
set local role anon;
do $$
begin
  begin
    perform count(*) from public.orders;
    raise exception 'Guests must not read orders';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.place_order(gen_random_uuid(), 1, '[]'::jsonb);
    raise exception 'Guests must not place orders';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Student A places orders only through place_order().
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated", "email": "order-test-a@vanderbilt.edu"}', true);
do $$
declare
  v_meal jsonb := '[{"id": "pub-burger", "quantity": 1}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]';
  v_first uuid;
  v_again uuid;
begin
  v_first := public.place_order('00000000-0000-4000-8000-000000000001', 1, v_meal);
  v_again := public.place_order('00000000-0000-4000-8000-000000000001', 1, v_meal);
  if v_first is distinct from v_again then
    raise exception 'Retrying with the same key must return the same order';
  end if;
  if (select status from public.orders where id = v_first) <> 'Received' then
    raise exception 'New orders must start as Received';
  end if;
  if (select student_email from public.orders where id = v_first) is distinct from 'order-test-a@vanderbilt.edu' then
    raise exception 'The ordering student email was not captured';
  end if;
  if (select count(*) from public.order_items where order_id = v_first) <> 3 then
    raise exception 'Expected three stored order items';
  end if;
  v_first := public.place_order(
    '00000000-0000-4000-8000-000000000002', 1,
    '[{"id": "pub-burger", "quantity": 1, "customization": "No onion"}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]'
  );
  if (select customization from public.order_items where order_id = v_first and menu_item_id = 'pub-burger')
     is distinct from 'No onion' then
    raise exception 'Customization was not stored on the order item';
  end if;
  begin
    perform public.place_order(gen_random_uuid(), 1, '[{"id": "pub-burger", "quantity": 1}]');
    raise exception 'An incomplete meal was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.place_order(
      gen_random_uuid(), 1,
      '[{"id": "not-on-menu", "quantity": 1}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]'
    );
    raise exception 'An item that is not on the menu was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.orders (user_id, swipes, idempotency_key)
    values ('00000000-0000-4000-8000-00000000000a', 1, gen_random_uuid());
    raise exception 'Students must not insert orders directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Student B cannot see student A's order.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
do $$
begin
  if (select count(*) from public.orders) <> 0 or (select count(*) from public.order_items) <> 0 then
    raise exception 'A student must not see another student''s orders';
  end if;
end $$;
reset role;

-- The repeated submission stored exactly one order.
do $$
begin
  if (select count(*) from public.orders where idempotency_key = '00000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'The repeated submission created a duplicate order';
  end if;
end $$;
-- US4: order status changes are published to Supabase Realtime (row-level security still
-- decides who receives them), and order items are not.
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
rollback;
