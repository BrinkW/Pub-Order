// Menu page tests for the entrée → side → drink order.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_STORAGE_KEY } from './cart.js';
import Menu from './Menu.jsx';
import { MENU_ITEMS } from './menu-data.js';

const catalog = MENU_ITEMS.map((item) => ({ ...item, available: true }));
const entrees = catalog.filter((item) => item.swipeType === 'Entry');

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => catalog })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(props = {}) {
  const user = userEvent.setup();
  const view = render(<Menu email="" onBack={vi.fn()} {...props} />);
  await screen.findByRole('button', { name: 'Add Pub Burger' });
  return { user, ...view };
}

function savedCart() {
  return JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY));
}

describe('Ordering one step at a time', () => {
  it('starts on entrées and hides sides and drinks', async () => {
    await setup();

    expect(screen.getAllByRole('article')).toHaveLength(entrees.length);
    expect(screen.queryByRole('button', { name: 'Add Straight Cut Fries' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrée' })).toHaveAttribute('aria-current', 'step');
  });

  it('choosing a main moves to sides, and skipping a side moves to drinks', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Add Pub Burger' }));

    expect(screen.getByRole('button', { name: 'Side' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Add Straight Cut Fries' })).toBeEnabled();
    expect(screen.getByText('Pub Burger added.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add No side' }));

    expect(savedCart().noSide).toBe(true);
    expect(savedCart().items).toEqual({ 'pub-burger': 1 });
    expect(screen.getByRole('button', { name: 'Drink' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Add Sweet Tea' })).toBeEnabled();
  });

  it('extra meal swipes stay on a step until that many items are added', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'More meal swipes' }));
    await user.click(screen.getByRole('button', { name: 'More meal swipes' }));

    expect(screen.getByRole('group', { name: 'Meal swipes' })).toHaveTextContent('3');
    await user.click(screen.getByRole('button', { name: 'Add Pub Burger' }));

    expect(screen.getByRole('button', { name: 'Entrée' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Pub Burger' }));
    await user.click(screen.getByRole('button', { name: 'Add Pub Burger' }));

    expect(screen.getByRole('button', { name: 'Side' })).toHaveAttribute('aria-current', 'step');
    expect(savedCart().swipes).toBe(3);
    expect(savedCart().items['pub-burger']).toBe(3);

    await user.click(screen.getByRole('button', { name: 'Add Pretzel Sticks' }));
    expect(screen.getByRole('button', { name: 'Side' })).toHaveAttribute('aria-current', 'step');
    await user.click(screen.getByRole('button', { name: 'Add Pretzel Sticks' }));
    await user.click(screen.getByRole('button', { name: 'Add Pretzel Sticks' }));

    expect(screen.getByRole('button', { name: 'Drink' })).toHaveAttribute('aria-current', 'step');
    await user.click(screen.getByRole('button', { name: 'Add Sweet Tea' }));
    await user.click(screen.getByRole('button', { name: 'Add Sweet Tea' }));
    await user.click(screen.getByRole('button', { name: 'Add Sweet Tea' }));

    expect(screen.getByRole('heading', { name: 'Look over your order' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Look over your order' })).toHaveTextContent('3 meal swipes');
  });

  it('a main, a side, and a drink open the review in plain language', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Add Pub Burger' }));
    await user.click(screen.getByRole('button', { name: 'Add Straight Cut Fries' }));
    await user.click(screen.getByRole('button', { name: 'Add Sweet Tea' }));

    expect(screen.getByRole('heading', { name: 'Look over your order' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check my order' })).not.toBeInTheDocument();
  });

  it('search only looks through the current step', async () => {
    const { user } = await setup();

    await user.type(screen.getByRole('searchbox'), 'pretzel');

    expect(screen.getByText('No matches this time.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('button', { name: 'Add Pub Burger' })).toBeInTheDocument();
  });

  it('falls back to a placeholder when an image fails to load', async () => {
    const { container } = await setup();
    const image = container.querySelector('img');

    fireEvent.error(image);

    expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('clears the order and saves a choice', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Add Pub Burger' }));

    expect(savedCart()).toEqual({ swipes: 1, items: { 'pub-burger': 1 }, reviewedTypes: { 'pub-burger': 'Entry' }, customizations: {} });
    expect(screen.queryByText(/saved on this browser/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear order' }));

    expect(screen.getByText('Order cleared.')).toBeInTheDocument();
    expect(savedCart()).toEqual({ swipes: 1, items: {}, reviewedTypes: {}, customizations: {} });
  });
});

describe('Saving the order', () => {
  it('shows a saved main on the meal summary', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ swipes: 1, items: { 'pub-burger': 1 }, reviewedTypes: { 'pub-burger': 'Entry' } }));

    await setup();

    expect(screen.getByRole('heading', { name: 'Your meal (1)' })).toBeInTheDocument();
    expect(screen.getAllByText('Pub Burger').length).toBeGreaterThan(1);
  });

  it('starts empty when the saved order is corrupt', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, '{broken');

    await setup();

    expect(screen.getByRole('heading', { name: 'Your meal (0)' })).toBeInTheDocument();
    expect(screen.getAllByText('Not chosen yet')).toHaveLength(2);
  });

  it('explains when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await setup();

    expect(screen.getByText(/Browser storage is unavailable/)).toBeInTheDocument();
  });
});

describe('Header and navigation', () => {
  it('shows the signed-in email and a way back to login', async () => {
    const onBack = vi.fn();
    const { user } = await setup({ email: 'student@vanderbilt.edu', onBack });

    expect(screen.getByText('Signed in as student@vanderbilt.edu')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to login' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('offers sign in when browsing without an account', async () => {
    await setup();

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });

  it('the header meal button moves focus to the summary', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Your meal 0' }));

    expect(screen.getByRole('heading', { name: 'Your meal (0)' })).toHaveFocus();
  });

  it('the skip link moves focus to the menu', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('link', { name: 'Skip to menu' }));

    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('Customizing a grill item', () => {
  function openCustomize(user, name) {
    const card = screen.getByRole('article', { name });
    return user.click(within(card).getByRole('button', { name: 'Customize' }));
  }

  it('gives burgers toppings and chicken its own sauces', async () => {
    const { user } = await setup();

    await openCustomize(user, 'Pub Burger');

    expect(screen.getByRole('checkbox', { name: 'Onion' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Cheese' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ketchup' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Ranch' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Add Pub Burger' }));

    expect(within(screen.getByRole('article', { name: 'Straight Cut Fries' })).queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrée' }));
    await openCustomize(user, 'Chicken Tenders');

    expect(screen.getByRole('checkbox', { name: 'Ranch' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Onion' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Cheese' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Ranch' }));
    await user.click(screen.getByRole('button', { name: 'Add with these options' }));

    expect(screen.getByText(/Ranch/)).toBeInTheDocument();
  });

  it('keeps tartar sauce on the cod unless it is unchecked', async () => {
    const { user } = await setup();

    await openCustomize(user, 'Fried Cod w/ Tartar Sauce');

    expect(screen.getByRole('checkbox', { name: 'Tartar sauce' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Malt vinegar' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Pickles' })).not.toBeInTheDocument();
  });
});
