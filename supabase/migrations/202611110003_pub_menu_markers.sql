-- NetNutrition markers shown for the Pub's current menu on November 11, 2026.
-- The column supports every allergen and preference marker exposed by the Pub website.

alter table public.menu_items
  add column markers text[] not null default '{}';

alter table public.menu_items
  add constraint menu_items_known_markers check (
    markers <@ array[
      'Alcohol', 'Dairy', 'Egg', 'Fish', 'Gluten', 'Peanut', 'Pork', 'Sesame',
      'Shellfish', 'Soy', 'Tree Nut', 'Features Local Ingredient', 'Halal', 'Kosher',
      'Vegan', 'Vegetarian'
    ]::text[]
    and cardinality(markers) <= 16
  );

update public.menu_items
set markers = case id
  when 'beyond-burger-patty' then array['Vegan']
  when 'chicken-sandwich' then array['Gluten', 'Sesame']
  when 'chicken-tenders' then array['Gluten']
  when 'fried-cod-with-tartar-sauce' then array['Alcohol', 'Egg', 'Fish', 'Gluten']
  when 'loaded-fries' then array['Dairy', 'Vegetarian']
  when 'philly-cheesesteak' then array['Dairy', 'Gluten', 'Sesame']
  when 'pub-burger' then array['Gluten', 'Sesame', 'Features Local Ingredient']
  when 'seasoned-wings' then array['Gluten', 'Halal']
  when 'cauliflower-wings' then array['Dairy', 'Gluten', 'Vegetarian']
  when 'pretzel-sticks' then array['Dairy', 'Gluten', 'Vegetarian']
  when 'straight-cut-fries' then array['Vegan']
  when 'apple-juice' then array['Vegan']
  when 'cranberry-juice' then array['Vegan']
  when 'lemon-lime-gatorade' then array['Vegan']
  when 'orange-gatorade' then array['Vegan']
  when 'orange-juice' then array['Vegan']
  when 'sobe-yumberry-pomegranate' then array['Vegan']
  when 'sweet-tea' then array['Vegan']
  when 'tropicana-lemonade' then array['Vegan']
  when 'chocolate-milkshake' then array['Dairy', 'Egg', 'Vegetarian']
  when 'strawberry-milkshake' then array['Dairy', 'Egg', 'Vegetarian']
  when 'vanilla-milkshake' then array['Dairy', 'Egg', 'Vegetarian']
  else '{}'
end;
