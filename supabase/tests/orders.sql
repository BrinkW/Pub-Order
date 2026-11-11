-- Run against a disposable database after applying the migrations (CI: local Supabase).
-- Everything runs in one transaction that is rolled back, so nothing is left behind.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'order-test-a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'order-test-b@example.com');

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
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated", "email": "order-test-a@example.com"}', true);
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
  if (select student_email from public.orders where id = v_first) is distinct from 'order-test-a@example.com' then
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

-- SEC-03: a student can have at most 3 orders in progress and place at most 5 in 10 minutes.
-- Student B has no orders yet. Status changes are made as the database owner, like the kitchen.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
do $$
declare
  v_meal jsonb := '[{"id": "pub-burger", "quantity": 1}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]';
  v_first uuid;
  v_detail text;
begin
  v_first := public.place_order('00000000-0000-4000-8000-0000000000b1', 1, v_meal);
  perform public.place_order('00000000-0000-4000-8000-0000000000b2', 1, v_meal);
  perform public.place_order('00000000-0000-4000-8000-0000000000b3', 1, v_meal);
  begin
    perform public.place_order('00000000-0000-4000-8000-0000000000b4', 1, v_meal);
    raise exception 'SEC-03: a fourth order in progress was accepted';
  exception when sqlstate 'PT429' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'open_orders' then
      raise exception 'SEC-03: expected the open-orders limit, got %', v_detail;
    end if;
  end;
  if public.place_order('00000000-0000-4000-8000-0000000000b1', 1, v_meal) is distinct from v_first then
    raise exception 'SEC-03: retrying a placed order must still return it at the limit';
  end if;
end $$;
reset role;

-- Picking up one order makes room for another.
update public.orders set status = 'Collected' where idempotency_key = '00000000-0000-4000-8000-0000000000b1';
set local role authenticated;
do $$
begin
  perform public.place_order(
    '00000000-0000-4000-8000-0000000000b4', 1,
    '[{"id": "pub-burger", "quantity": 1}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]'
  );
end $$;
reset role;

-- A fifth order in 10 minutes is still allowed; a sixth is not, even with room in progress.
update public.orders set status = 'Collected' where idempotency_key = '00000000-0000-4000-8000-0000000000b2';
set local role authenticated;
do $$
begin
  perform public.place_order(
    '00000000-0000-4000-8000-0000000000b5', 1,
    '[{"id": "pub-burger", "quantity": 1}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]'
  );
end $$;
reset role;
update public.orders set status = 'Collected' where idempotency_key = '00000000-0000-4000-8000-0000000000b3';
set local role authenticated;
do $$
declare
  v_detail text;
begin
  perform public.place_order(
    '00000000-0000-4000-8000-0000000000b6', 1,
    '[{"id": "pub-burger", "quantity": 1}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]'
  );
  raise exception 'SEC-03: a sixth order in 10 minutes was accepted';
exception when sqlstate 'PT429' then
  get stacked diagnostics v_detail = pg_exception_detail;
  if v_detail <> 'recent_orders' then
    raise exception 'SEC-03: expected the recent-orders limit, got %', v_detail;
  end if;
end $$;
reset role;
rollback;
