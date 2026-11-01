-- US23: a student can cancel their own order while it is still Received.
-- Once the kitchen has started it, the order can no longer be cancelled, and the kitchen
-- cannot move a cancelled order back into the queue.

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('Received', 'Preparing', 'Ready', 'Collected', 'Cancelled'));

-- Errors: 42501 not signed in, P0002 no such order for this student (someone else's order
-- looks the same as a missing one), 55000 the kitchen has already started it.
-- Cancelling an order that is already cancelled succeeds, so a retried request is harmless.
create function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
begin
  if v_user is null then
    raise exception 'cancel_order: sign in required' using errcode = '42501';
  end if;

  -- One statement, so a kitchen status change can't slip in between a check and the update.
  update public.orders
  set status = 'Cancelled', updated_at = now()
  where id = p_order_id and user_id = v_user and status = 'Received';
  if found then
    return;
  end if;

  select o.status into v_status
  from public.orders o
  where o.id = p_order_id and o.user_id = v_user;
  if not found then
    raise exception 'cancel_order: order not found' using errcode = 'P0002';
  end if;
  if v_status <> 'Cancelled' then
    raise exception 'cancel_order: the kitchen has already started this order' using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.cancel_order(uuid) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;

-- Same as before, except a cancelled order stays cancelled.
create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_kitchen() then
    raise exception 'set_order_status: kitchen access required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('Received', 'Preparing', 'Ready', 'Collected') then
    raise exception 'set_order_status: unknown status' using errcode = '22023';
  end if;
  update public.orders
  set status = p_status, updated_at = now()
  where id = p_order_id and status <> 'Cancelled';
  if found then
    return;
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'set_order_status: the order was cancelled' using errcode = '55000';
  end if;
  raise exception 'set_order_status: order not found' using errcode = 'P0002';
end;
$$;
