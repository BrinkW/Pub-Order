-- Run against a disposable database after applying the migration.
-- Transaction leaves the fixture catalog unchanged.
begin;
do $$
begin
  if (select count(*) from public.menu_items) <> 22 then
    raise exception 'Expected 22 seed items';
  end if;
  if (select count(*) from public.menu_items where swipe_type = 'Entry') <> 11 then
    raise exception 'Expected 8 entrees plus 3 milkshakes';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.menu_items'::regclass) then
    raise exception 'Row-level security must be enabled';
  end if;
  if (select markers from public.menu_items where id = 'seasoned-wings')
     is distinct from array['Gluten', 'Halal'] then
    raise exception 'Seasoned Wings markers do not match the Pub website';
  end if;
  if (select markers from public.menu_items where id = 'pub-burger')
     is distinct from array['Gluten', 'Sesame', 'Features Local Ingredient'] then
    raise exception 'Pub Burger markers do not match the Pub website';
  end if;
  if exists (select 1 from public.menu_items where markers is null) then
    raise exception 'Every menu item must have a marker array';
  end if;
  begin
    insert into public.menu_items (id, name, category, swipe_type) values ('bad', 'Bad', 'Test', 'Other');
    raise exception 'Invalid meal category was accepted';
  exception when check_violation then null;
  end;
end $$;
set local role anon;
do $$
begin
  if (select count(*) from public.menu_items) <> 22 then
    raise exception 'Guests must be able to browse the seeded menu';
  end if;
  begin
    update public.menu_items set available = false;
    raise exception 'Guest update should be rejected';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.menu_items;
    raise exception 'Guest truncate should be rejected';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$
begin
  if (select count(*) from public.menu_items) <> 22 then
    raise exception 'Students must be able to read the menu';
  end if;
  begin
    delete from public.menu_items;
    raise exception 'Student deletion should be rejected';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.menu_items (id, name, category, swipe_type) values ('bad', 'Bad', 'Test', 'Entry');
    raise exception 'Student insert should be rejected';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
