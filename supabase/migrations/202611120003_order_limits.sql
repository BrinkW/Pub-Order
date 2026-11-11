-- SEC-03: limit how many orders one student can place, so a script can't flood the kitchen.
-- A student can have at most 3 orders in progress (Received, Preparing or Ready) and can
-- place at most 5 orders in any 10 minutes, cancelled ones included. Retrying an order that
-- was already placed (same idempotency key) still returns it.
-- The limits live in place_order itself, so they also apply to anyone calling the function
-- directly with the public key, not only to requests through our API.
-- Error: errcode PT429 (PostgREST answers it with HTTP 429); the detail says which limit,
-- 'open_orders' or 'recent_orders'. Everything else is unchanged from
-- 202610200001_order_item_customization.sql.
-- Safe to run again: the function is replaced.

create or replace function public.place_order(p_idempotency_key uuid, p_swipes integer, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_order uuid;
  c_max_open constant integer := 3;
  c_max_recent constant integer := 5;
  c_recent_window constant interval := interval '10 minutes';
begin
  if v_user is null then
    raise exception 'place_order: sign in required' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'place_order: missing idempotency key' using errcode = '22023';
  end if;

  select o.id into v_order
  from public.orders o
  where o.user_id = v_user and o.idempotency_key = p_idempotency_key;
  if found then
    return v_order;
  end if;

  -- One student's orders are counted and placed one at a time, so two requests sent together
  -- can't both slip under a limit.
  perform pg_advisory_xact_lock(hashtextextended('place_order:' || v_user::text, 0));
  if (select count(*) from public.orders o
      where o.user_id = v_user and o.status in ('Received', 'Preparing', 'Ready')) >= c_max_open then
    raise exception 'place_order: too many orders in progress'
      using errcode = 'PT429', detail = 'open_orders';
  end if;
  if (select count(*) from public.orders o
      where o.user_id = v_user and o.created_at > now() - c_recent_window) >= c_max_recent then
    raise exception 'place_order: too many orders placed recently'
      using errcode = 'PT429', detail = 'recent_orders';
  end if;

  if p_swipes is null or p_swipes not between 1 and 10 then
    raise exception 'place_order: swipes must be between 1 and 10' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'place_order: the order has no items' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_to_recordset(p_items) as r(id text))
     <> (select count(distinct r.id) from jsonb_to_recordset(p_items) as r(id text)) then
    raise exception 'place_order: each menu item may appear only once' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as r(id text, quantity integer)
    left join public.menu_items m on m.id = r.id
    where m.id is null or not m.available or r.quantity is null or r.quantity not between 1 and 10
  ) then
    raise exception 'place_order: an item is unavailable or has an invalid quantity' using errcode = '22023';
  end if;
  if exists (
    select 1
    from (values ('Entry'), ('Side'), ('Drink')) as t(swipe_type)
    where coalesce((
      select sum(r.quantity)
      from jsonb_to_recordset(p_items) as r(id text, quantity integer)
      join public.menu_items m on m.id = r.id
      where m.swipe_type = t.swipe_type
    ), 0) <> p_swipes
  ) then
    raise exception 'place_order: each meal swipe needs exactly one entry, side, and drink' using errcode = '22023';
  end if;

  insert into public.orders (user_id, swipes, idempotency_key)
  values (v_user, p_swipes, p_idempotency_key)
  returning id into v_order;

  insert into public.order_items (order_id, menu_item_id, name, swipe_type, quantity, customization)
  select v_order, m.id, m.name, m.swipe_type, r.quantity, left(coalesce(r.customization, ''), 200)
  from jsonb_to_recordset(p_items) as r(id text, quantity integer, customization text)
  join public.menu_items m on m.id = r.id;

  return v_order;
exception
  when unique_violation then
    select o.id into v_order
    from public.orders o
    where o.user_id = v_user and o.idempotency_key = p_idempotency_key;
    return v_order;
end;
$$;
