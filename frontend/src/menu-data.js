// Seed reference and test fixture only. Runtime menu data comes from GET /api/menu.
// One meal swipe = one Entry + one Drink. A Side is optional.
export const MENU_IMAGE_BASE = '/images/menu/';

export const MENU_ITEMS = [
  // Grill Main
  { id: 'beyond-burger-patty', name: 'Beyond Burger Patty', category: 'Grill Main', swipeType: 'Entry', description: '', portion: '1 patty', label: 'Vegan', markers: ['Vegan'], image: 'beyond-burger-patty.jpg' },
  { id: 'chicken-sandwich', name: 'Chicken Sandwich', category: 'Grill Main', swipeType: 'Entry', description: '', portion: '1 sandwich', label: '', markers: ['Gluten', 'Sesame'], image: 'chicken-sandwich.jpg' },
  { id: 'chicken-tenders', name: 'Chicken Tenders', category: 'Grill Main', swipeType: 'Entry', description: '', portion: '3 tenders', label: '', markers: ['Gluten'], image: 'chicken-tenders.jpg' },
  { id: 'fried-cod-with-tartar-sauce', name: 'Fried Cod w/ Tartar Sauce', category: 'Grill Main', swipeType: 'Entry', description: '', portion: '4 oz. portion', label: '', markers: ['Alcohol', 'Egg', 'Fish', 'Gluten'], image: 'fried-cod-with-tartar-sauce.jpg' },
  { id: 'loaded-fries', name: 'Loaded Fries', category: 'Grill Main', swipeType: 'Entry', description: '', portion: '10 oz. portion', label: 'Vegetarian', markers: ['Dairy', 'Vegetarian'], image: 'loaded-fries.jpg' },
  { id: 'philly-cheesesteak', name: 'Philly Cheesesteak', category: 'Grill Main', swipeType: 'Entry', description: '', portion: '1 sandwich', label: '', markers: ['Dairy', 'Gluten', 'Sesame'], image: 'philly-cheesesteak.jpg' },
  { id: 'pub-burger', name: 'Pub Burger', category: 'Grill Main', swipeType: 'Entry', description: '', portion: '1 burger', label: '', markers: ['Gluten', 'Sesame', 'Features Local Ingredient'], image: 'pub-burger.jpg' },
  { id: 'seasoned-wings', name: 'Seasoned Wings', category: 'Grill Main', swipeType: 'Entry', description: '', portion: '5 wings', label: 'Halal', markers: ['Gluten', 'Halal'], image: 'seasoned-wings.jpg' },

  // Grill Side
  { id: 'cauliflower-wings', name: 'Cauliflower "Wings"', category: 'Grill Side', swipeType: 'Side', description: '', portion: '8 oz. portion', label: 'Vegetarian', markers: ['Dairy', 'Gluten', 'Vegetarian'], image: 'cauliflower-wings.jpg' },
  { id: 'pretzel-sticks', name: 'Pretzel Sticks', category: 'Grill Side', swipeType: 'Side', description: '', portion: '2 pretzels', label: 'Vegetarian', markers: ['Dairy', 'Gluten', 'Vegetarian'], image: 'pretzel-sticks.jpg' },
  { id: 'straight-cut-fries', name: 'Straight Cut Fries', category: 'Grill Side', swipeType: 'Side', description: '', portion: '3 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'straight-cut-fries.jpg' },

  // Beverages (all Vegan)
  { id: 'apple-juice', name: 'Apple Juice', category: 'Beverages', swipeType: 'Drink', description: '', portion: '8 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'apple-juice.jpg' },
  { id: 'cranberry-juice', name: 'Cranberry Juice', category: 'Beverages', swipeType: 'Drink', description: '', portion: '8 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'cranberry-juice.jpg' },
  { id: 'lemon-lime-gatorade', name: 'Lemon Lime Gatorade', category: 'Beverages', swipeType: 'Drink', description: '', portion: '12 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'lemon-lime-gatorade.jpg' },
  { id: 'orange-gatorade', name: 'Orange Gatorade', category: 'Beverages', swipeType: 'Drink', description: '', portion: '12 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'orange-gatorade.jpg' },
  { id: 'orange-juice', name: 'Orange Juice', category: 'Beverages', swipeType: 'Drink', description: '', portion: '8 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'orange-juice.jpg' },
  { id: 'sobe-yumberry-pomegranate', name: 'Sobe Yumberry Pomegranate', category: 'Beverages', swipeType: 'Drink', description: '', portion: '12 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'sobe-yumberry-pomegranate.jpg' },
  { id: 'sweet-tea', name: 'Sweet Tea', category: 'Beverages', swipeType: 'Drink', description: '', portion: '8 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'sweet-tea.jpg' },
  { id: 'tropicana-lemonade', name: 'Tropicana Lemonade', category: 'Beverages', swipeType: 'Drink', description: '', portion: '12 oz. portion', label: 'Vegan', markers: ['Vegan'], image: 'tropicana-lemonade.jpg' },

  // Milkshakes (all Vegetarian, counts as an Entry choice)
  { id: 'chocolate-milkshake', name: 'Chocolate Milkshake', category: 'Milkshakes', swipeType: 'Entry', description: '', portion: '1 shake', label: 'Vegetarian', markers: ['Dairy', 'Egg', 'Vegetarian'], image: 'chocolate-milkshake.jpg' },
  { id: 'strawberry-milkshake', name: 'Strawberry Milkshake', category: 'Milkshakes', swipeType: 'Entry', description: '', portion: '1 shake', label: 'Vegetarian', markers: ['Dairy', 'Egg', 'Vegetarian'], image: 'strawberry-milkshake.jpg' },
  { id: 'vanilla-milkshake', name: 'Vanilla Milkshake', category: 'Milkshakes', swipeType: 'Entry', description: '', portion: '1 shake', label: 'Vegetarian', markers: ['Dairy', 'Egg', 'Vegetarian'], image: 'vanilla-milkshake.jpg' },
];

export const CATEGORIES = ['All', ...new Set(MENU_ITEMS.map((item) => item.category))];
