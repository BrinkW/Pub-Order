-- Run after the migrations, in one transaction that is rolled back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'order-test-a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'order-test-b@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'kitchen@puborder.test');

do $$
begin
  if (select role from public.profiles where user_id = '00000000-0000-4000-8000-00000000000a') <> 'student' then
    raise exception 'A normal sign-up must be a student';
  end if;
  if (select role from public.profiles where user_id = '00000000-0000-4000-8000-00000000000c') <> 'kitchen' then
    raise exception 'The kitchen test account must be kitchen';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
do $$
declare
  v_order uuid;
begin
  v_order := public.place_order(
    '00000000-0000-4000-8000-000000000010', 1,
    '[{"id": "pub-burger", "quantity": 1}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]'
  );
  begin
    perform public.set_order_status(v_order, 'Preparing');
    raise exception 'A student was allowed to change an order status';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.orders where id = v_order) <> 'Received' then
    raise exception 'A student status change was stored';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}', true);
do $$
declare
  v_order uuid;
begin
  if (select count(*) from public.orders) <> 1 then
    raise exception 'Kitchen must see every order';
  end if;
  select id into v_order from public.orders;
  perform public.set_order_status(v_order, 'Ready');
  if (select status from public.orders where id = v_order) <> 'Ready' then
    raise exception 'Kitchen status change was not stored';
  end if;
  begin
    perform public.set_order_status(v_order, 'Delivered');
    raise exception 'An unknown status was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_order_status('00000000-0000-4000-8000-000000000099', 'Collected');
    raise exception 'A missing order was updated';
  exception when no_data_found then null;
  end;
  perform public.set_item_availability('pub-burger', false);
  if (select available from public.menu_items where id = 'pub-burger') then
    raise exception 'Kitchen sold-out change was not stored';
  end if;
  perform public.set_item_availability('pub-burger', true);
end $$;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
do $$
begin
  if (select count(*) from public.orders) <> 0 then
    raise exception 'Another student must not see the order';
  end if;
  begin
    perform public.set_item_availability('pub-burger', false);
    raise exception 'A student was allowed to mark an item sold out';
  exception when insufficient_privilege then null;
  end;
end $$;

-- US23: a student cancels a new order; the kitchen can neither reopen nor cancel it.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
do $$
begin
  perform public.cancel_order(public.place_order(
    '00000000-0000-4000-8000-000000000011', 1,
    '[{"id": "pub-burger", "quantity": 1}, {"id": "straight-cut-fries", "quantity": 1}, {"id": "sweet-tea", "quantity": 1}]'
  ));
end $$;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}', true);
do $$
declare
  v_order uuid := (select id from public.orders where status = 'Cancelled');
begin
  begin
    perform public.set_order_status(v_order, 'Preparing');
    raise exception 'Kitchen reopened a cancelled order';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.cancel_order((select id from public.orders where status = 'Ready'));
    raise exception 'Kitchen cancelled a student''s order';
  exception when no_data_found then null;
  end;
end $$;

rollback;
