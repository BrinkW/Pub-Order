function choice(id, label, text, included) {
  return { id, label, text, included };
}

// Stored ids are the difference from the plate: a checked-by-default topping is
// saved only when it is removed, and an optional sauce is saved only when it is added.
const ITEMS = {
  'beyond-burger-patty': {
    hint: '',
    options: [
      choice('no-lettuce', 'Lettuce', 'No lettuce', true),
      choice('no-tomato', 'Tomato', 'No tomato', true),
      choice('no-onion', 'Onion', 'No onion', true),
      choice('no-pickles', 'Pickles', 'No pickles', true),
      choice('ketchup', 'Ketchup', 'Ketchup', false),
    ],
  },
  'chicken-sandwich': {
    hint: 'The sandwich comes with the checked toppings. Uncheck one to leave it off, or add a sauce.',
    options: [
      choice('no-lettuce', 'Lettuce', 'No lettuce', true),
      choice('no-tomato', 'Tomato', 'No tomato', true),
      choice('no-pickles', 'Pickles', 'No pickles', true),
      choice('no-mayo', 'Mayo', 'No mayo', true),
      choice('buffalo', 'Buffalo', 'Buffalo', false),
      choice('ranch', 'Ranch', 'Ranch', false),
      choice('honey-mustard', 'Honey mustard', 'Honey mustard', false),
      choice('bbq', 'BBQ', 'BBQ', false),
    ],
  },
  'chicken-tenders': {
    hint: 'Check the dipping sauces you want.',
    options: [
      choice('ranch', 'Ranch', 'Ranch', false),
      choice('honey-mustard', 'Honey mustard', 'Honey mustard', false),
      choice('bbq', 'BBQ', 'BBQ', false),
      choice('buffalo', 'Buffalo', 'Buffalo', false),
      choice('ketchup', 'Ketchup', 'Ketchup', false),
      choice('sweet-chili', 'Sweet chili', 'Sweet chili', false),
    ],
  },
  'fried-cod-with-tartar-sauce': {
    hint: 'Tartar sauce and lemon come with the cod. Uncheck either one, or add a sauce.',
    options: [
      choice('no-tartar', 'Tartar sauce', 'No tartar sauce', true),
      choice('no-lemon', 'Lemon', 'No lemon', true),
      choice('malt-vinegar', 'Malt vinegar', 'Malt vinegar', false),
      choice('hot-sauce', 'Hot sauce', 'Hot sauce', false),
    ],
  },
  'loaded-fries': {
    hint: 'The fries come loaded with the checked toppings. Uncheck one to leave it off, or add something else.',
    options: [
      choice('no-cheese-sauce', 'Cheese sauce', 'No cheese sauce', true),
      choice('no-sour-cream', 'Sour cream', 'No sour cream', true),
      choice('no-green-onion', 'Green onions', 'No green onions', true),
      choice('jalapenos', 'Jalapeños', 'Jalapeños', false),
      choice('ranch', 'Ranch', 'Ranch', false),
    ],
  },
  'philly-cheesesteak': {
    hint: 'Onions and cheese come on the cheesesteak. Uncheck one to leave it off, or add a topping.',
    options: [
      choice('no-onion', 'Onions', 'No onion', true),
      choice('no-cheese', 'Cheese', 'No cheese', true),
      choice('peppers', 'Peppers', 'Peppers', false),
      choice('mushrooms', 'Mushrooms', 'Mushrooms', false),
      choice('mayo', 'Mayo', 'Mayo', false),
      choice('hot-sauce', 'Hot sauce', 'Hot sauce', false),
    ],
  },
  'pub-burger': {
    hint: 'The burger comes with the checked toppings. Uncheck one to leave it off, or add a sauce.',
    options: [
      choice('no-lettuce', 'Lettuce', 'No lettuce', true),
      choice('no-tomato', 'Tomato', 'No tomato', true),
      choice('no-onion', 'Onion', 'No onion', true),
      choice('no-pickles', 'Pickles', 'No pickles', true),
      choice('no-cheese', 'Cheese', 'No cheese', true),
      choice('ketchup', 'Ketchup', 'Ketchup', false),
      choice('mustard', 'Mustard', 'Mustard', false),
      choice('mayo', 'Mayo', 'Mayo', false),
    ],
  },
  'seasoned-wings': {
    hint: 'The wings are already seasoned. Check any dipping sauces you want.',
    options: [
      choice('ranch', 'Ranch', 'Ranch', false),
      choice('blue-cheese', 'Blue cheese', 'Blue cheese', false),
      choice('buffalo', 'Buffalo', 'Buffalo', false),
      choice('bbq', 'BBQ', 'BBQ', false),
      choice('honey-mustard', 'Honey mustard', 'Honey mustard', false),
    ],
  },
};

const OPTIONS = new Map(Object.values(ITEMS).flatMap((group) => group.options.map((option) => [option.id, option])));

export function optionsFor(item) {
  return ITEMS[item?.id]?.options || [];
}

export function customizeHint(item) {
  return ITEMS[item?.id]?.hint || '';
}

export function allowedOptionIds(item) {
  return new Set(optionsFor(item).map((option) => option.id));
}

export function isOptionId(id) {
  return OPTIONS.has(id);
}

export function includedOptionIds(item, storedIds) {
  const stored = new Set(storedIds || []);
  return optionsFor(item).filter((option) => option.included !== stored.has(option.id)).map((option) => option.id);
}

export function customizationText(optionIds) {
  return (optionIds || []).map((id) => OPTIONS.get(id)?.text).filter(Boolean).join(', ');
}
