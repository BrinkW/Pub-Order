// Menu page tests for browsing and building a cart with the full menu.
// Loading, search, checkout review, and unavailable items are covered in Menu.test.jsx.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_STORAGE_KEY, MAX_SWIPES } from './cart.js';
import Menu from './Menu.jsx';
import { MENU_ITEMS } from './menu-data.js';

vi.mock('./CrowdMeter.jsx', () => ({ CrowdMeter: () => null, CrowdMeterControls: () => null }));

const catalog = MENU_ITEMS.map((item) => ({ ...item, available: true }));

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
  await screen.findByRole('button', { name: 'Add Pub Burger to cart' });
  return { user, ...view };
}

function addButton(name) {
  return screen.getByRole('button', { name: `Add ${name} to cart` });
}

function savedCart() {
  return JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY));
}

function swipeCount() {
  return screen.getByLabelText('Meal swipes count');
}

describe('Browsing the full menu', () => {
  it('shows every menu item', async () => {
    await setup();

    expect(screen.getAllByRole('article')).toHaveLength(catalog.length);
    expect(screen.getByText(`${catalog.length} items to choose from`)).toBeInTheDocument();
  });

  it('builds the category buttons from the menu and filters by category', async () => {
    const { user } = await setup();
    const sides = catalog.filter((item) => item.category === 'Grill Side');

    await user.click(screen.getByRole('button', { name: 'Grill Side' }));

    expect(screen.getAllByRole('article')).toHaveLength(sides.length);
    expect(screen.getByText(`${sides.length} items in grill side`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grill Side' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to a placeholder when an image fails to load', async () => {
    const { container } = await setup();
    const image = container.querySelector('img');

    fireEvent.error(image);

    expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('shows every Pub marker instead of only one dietary label', async () => {
    await setup();
    const burger = screen.getByRole('heading', { name: 'Pub Burger' }).closest('article');

    expect(within(burger).getByText('Gluten')).toBeInTheDocument();
    expect(within(burger).getByText('Sesame')).toBeInTheDocument();
    expect(within(burger).getByText('Features Local Ingredient')).toBeInTheDocument();
  });
});

describe('Adding to the cart', () => {
  it('adds an item and updates the cart, header count, and notice', async () => {
    const { user } = await setup();

    await user.click(addButton('Pub Burger'));

    expect(screen.getByRole('heading', { name: 'Your cart (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cart 1' })).toBeInTheDocument();
    expect(screen.getByText('Pub Burger added to your cart.')).toBeInTheDocument();
    expect(screen.getByLabelText('Pub Burger quantity')).toHaveTextContent('1');
  });

  it('shows how many of an item are in the cart while more can be added', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Increase meal swipes' }));
    await user.click(addButton('Pub Burger'));

    expect(addButton('Pub Burger')).toHaveTextContent('1 in cart');
  });

  it('blocks more items of a full type but not other types', async () => {
    const { user } = await setup();

    await user.click(addButton('Pub Burger'));

    expect(addButton('Chicken Tenders')).toBeDisabled();
    expect(addButton('Chicken Tenders')).toHaveTextContent('Entry limit reached');
    expect(addButton('Straight Cut Fries')).toBeEnabled();
    expect(addButton('Sweet Tea')).toBeEnabled();
  });

  it('shows progress for each part of a meal swipe', async () => {
    const { user } = await setup();

    await user.click(addButton('Pub Burger'));
    await user.click(addButton('Straight Cut Fries'));
    await user.click(addButton('Sweet Tea'));

    expect(screen.getByText('Entries').querySelector('strong')).toHaveTextContent('1/1');
    expect(screen.getByText('Sides').querySelector('strong')).toHaveTextContent('1/1');
    expect(screen.getByText('Drinks').querySelector('strong')).toHaveTextContent('1/1');
  });
});

describe('Meal swipes', () => {
  it('cannot go below one swipe', async () => {
    await setup();

    expect(swipeCount()).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Decrease meal swipes' })).toBeDisabled();
  });

  it('raising swipes allows another item of the same type', async () => {
    const { user } = await setup();

    await user.click(addButton('Pub Burger'));
    await user.click(screen.getByRole('button', { name: 'Increase meal swipes' }));

    expect(swipeCount()).toHaveTextContent('2');
    expect(addButton('Chicken Tenders')).toBeEnabled();
  });

  it('cannot drop below the number of items of the busiest type', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Increase meal swipes' }));
    await user.click(addButton('Pub Burger'));
    await user.click(addButton('Chicken Tenders'));

    expect(screen.getByRole('button', { name: 'Decrease meal swipes' })).toBeDisabled();
  });

  it(`stops at ${MAX_SWIPES} swipes`, async () => {
    const { user } = await setup();
    const increase = screen.getByRole('button', { name: 'Increase meal swipes' });

    for (let swipes = 1; swipes < MAX_SWIPES; swipes += 1) {
      await user.click(increase);
    }

    expect(swipeCount()).toHaveTextContent(String(MAX_SWIPES));
    expect(increase).toBeDisabled();
  });
});

describe('Changing the cart', () => {
  it('changes quantity within the swipe allowance', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Increase meal swipes' }));
    await user.click(addButton('Pub Burger'));
    await user.click(screen.getByRole('button', { name: 'Increase Pub Burger quantity' }));

    expect(screen.getByLabelText('Pub Burger quantity')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Increase Pub Burger quantity' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Decrease Pub Burger quantity' }));

    expect(screen.getByLabelText('Pub Burger quantity')).toHaveTextContent('1');
  });

  it('decreasing to zero empties the cart', async () => {
    const { user } = await setup();

    await user.click(addButton('Pub Burger'));
    await user.click(screen.getByRole('button', { name: 'Decrease Pub Burger quantity' }));

    expect(screen.getByRole('heading', { name: 'A little hungry?' })).toBeInTheDocument();
  });

  it('removes a single item', async () => {
    const { user } = await setup();

    await user.click(addButton('Pub Burger'));
    await user.click(addButton('Sweet Tea'));
    await user.click(screen.getByRole('button', { name: 'Remove Pub Burger from cart' }));

    expect(screen.queryByLabelText('Pub Burger quantity')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sweet Tea quantity')).toHaveTextContent('1');
    expect(screen.getByText('Pub Burger removed from your cart.')).toBeInTheDocument();
  });

  it('clears the whole cart', async () => {
    const { user } = await setup();

    await user.click(addButton('Pub Burger'));
    await user.click(addButton('Sweet Tea'));
    await user.click(screen.getByRole('button', { name: 'Clear cart' }));

    expect(screen.getByRole('heading', { name: 'A little hungry?' })).toBeInTheDocument();
    expect(screen.getByText('Cart cleared.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear cart' })).not.toBeInTheDocument();
    expect(savedCart()).toEqual({ swipes: 1, items: {}, reviewedTypes: {}, customizations: {} });
  });
});

describe('Saving the cart', () => {
  it('saves changes to browser storage', async () => {
    const { user } = await setup();

    await user.click(addButton('Pub Burger'));

    expect(savedCart()).toEqual({ swipes: 1, items: { 'pub-burger': 1 }, reviewedTypes: { 'pub-burger': 'Entry' }, customizations: {} });
    expect(screen.getByText(/Cart saved on this browser/)).toBeInTheDocument();
  });

  it('restores a saved cart', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ swipes: 2, items: { 'pub-burger': 2 } }));

    await setup();

    expect(swipeCount()).toHaveTextContent('2');
    expect(screen.getByLabelText('Pub Burger quantity')).toHaveTextContent('2');
  });

  it('starts empty when the saved cart is corrupt', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, '{broken');

    await setup();

    expect(screen.getByRole('heading', { name: 'A little hungry?' })).toBeInTheDocument();
    expect(swipeCount()).toHaveTextContent('1');
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

  it('the header cart button moves focus to the cart', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Cart 0' }));

    expect(screen.getByRole('heading', { name: 'Your cart (0)' })).toHaveFocus();
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
    expect(within(screen.getByRole('article', { name: 'Straight Cut Fries' })).queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await openCustomize(user, 'Chicken Tenders');

    expect(screen.getByRole('checkbox', { name: 'Ranch' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Onion' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Cheese' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Ranch' }));
    await user.click(screen.getByRole('button', { name: 'Add with these options' }));

    expect(screen.getByText('Ranch')).toBeInTheDocument();
  });

  it('keeps tartar sauce on the cod unless it is unchecked', async () => {
    const { user } = await setup();

    await openCustomize(user, 'Fried Cod w/ Tartar Sauce');

    expect(screen.getByRole('checkbox', { name: 'Tartar sauce' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Malt vinegar' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Pickles' })).not.toBeInTheDocument();
  });
});
