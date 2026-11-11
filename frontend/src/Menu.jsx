import { useEffect, useRef, useState } from 'react';
import Checkout from './Checkout.jsx';
import { CrowdMeter } from './CrowdMeter.jsx';
import CustomizeDialog from './CustomizeDialog.jsx';
import NutritionDialog from './NutritionDialog.jsx';
import { loadMenu } from './menu-api.js';
import { optionsFor } from './customizations.js';
import { CART_STORAGE_KEY, MAX_SWIPES, emptyCart, filterMenu, getCartSummary, restoreCart, setCustomizations, setQuantity, setSwipes, withCheckoutKey } from './cart.js';

const MENU_IMAGE_BASE = '/images/menu/';
const IMAGE_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23f2ecdf'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='18' fill='%23a89f8c' text-anchor='middle' dominant-baseline='middle'%3ENo image%3C/text%3E%3C/svg%3E";
const PREFERENCE_MARKERS = new Set(['Features Local Ingredient', 'Halal', 'Kosher', 'Vegan', 'Vegetarian']);

function markersFor(item) {
  return item.markers?.length ? item.markers : (item.label ? [item.label] : []);
}

function initialCart() {
  try { return restoreCart(window.localStorage.getItem(CART_STORAGE_KEY)); }
  catch { return emptyCart(); }
}

export default function Menu({ email, onBack, onViewOrders, onOrderPlaced }) {
  const [cart, setCart] = useState(initialCart);
  const [catalog, setCatalog] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [checkout, setCheckout] = useState(false);
  const focusCartAfterRender = useRef(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [notice, setNotice] = useState('');
  const [customizing, setCustomizing] = useState(null);
  const [details, setDetails] = useState(null);
  const [canSave, setCanSave] = useState(true);
  const summary = getCartSummary(cart, catalog);
  const visibleItems = filterMenu(query, category, catalog);
  const categories = ['All', ...new Set(catalog.map((item) => item.category))];
  const minSwipesNeeded = Math.max(summary.counts.Entry, summary.counts.Side, summary.counts.Drink, 1);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      setCanSave(true);
    } catch { setCanSave(false); }
  }, [cart]);

  useEffect(() => {
    const controller = new AbortController();
    let background = false;

    async function load() {
      if (!background) { setLoadState('loading'); setLoadError(''); }
      try {
        const items = await loadMenu(controller.signal);
        if (controller.signal.aborted) return;
        setCatalog(items);
        setLoadState('ready');
      } catch (error) {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        if (!background) { setLoadError(error.message); setLoadState('error'); }
      }
    }

    load();
    // Pick up sold-out changes while a student is looking at the menu.
    const timer = setInterval(() => { background = true; load(); }, 10000);
    function onVisible() {
      if (document.hidden) return;
      background = true;
      load();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [attempt]);

  // Save the cart's checkout key before submitting, so a retry after a failure reuses it.
  function ensureCheckoutKey() {
    const keyed = withCheckoutKey(cart);
    if (keyed !== cart) setCart(keyed);
    return keyed;
  }

  // US4: only a saved order reaches here. Clear the cart, then open the order's confirmation page.
  function orderPlaced(order, checkoutKey) {
    // Preserve a new/edited meal if the student changed it while this order was saving.
    setCart((current) => current.checkoutKey === checkoutKey ? emptyCart() : current);
    setCheckout(false);
    setNotice('');
    onOrderPlaced?.(order);
  }

  function acceptChanges(result) {
    // Update only reviewed items; do not erase the rest of the catalog.
    const updates = new Map(result.items.map((item) => [item.id, item]));
    const unavailable = new Set(result.issues.filter((issue) => issue.code === 'unavailable').map((issue) => issue.id));
    setCatalog((current) => current.map((item) => ({ ...item, ...updates.get(item.id), ...(unavailable.has(item.id) ? { available: false } : {}) })));
    setCart((current) => ({ ...current, reviewedTypes: { ...current.reviewedTypes, ...Object.fromEntries(result.items.map((item) => [item.id, item.swipeType])) } }));
    setCheckout(false);
    setNotice('Menu changes reviewed. Adjust your cart and validate checkout again.');
  }

  function focusCart() {
    document.getElementById('cart')?.scrollIntoView?.({ behavior: 'smooth' });
    document.getElementById('cart-title')?.focus({ preventScroll: true });
  }

  function showCart() {
    if (checkout) { focusCartAfterRender.current = true; setCheckout(false); }
    else focusCart();
  }

  useEffect(() => {
    if (!checkout && focusCartAfterRender.current) {
      focusCartAfterRender.current = false;
      focusCart();
    }
  }, [checkout]);

  function addItem(item) {
    setCart((current) => setQuantity(current, item.id, (current.items[item.id] || 0) + 1, catalog));
    setNotice(`${item.name} added to your cart.`);
  }

  function saveCustomization(optionIds) {
    const item = customizing;
    if (!item) return;
    setCart((current) => {
      const withItem = current.items[item.id] ? current : setQuantity(current, item.id, 1, catalog);
      if (!withItem.items[item.id]) return current;
      return setCustomizations(withItem, item, optionIds);
    });
    setNotice(cart.items[item.id] ? `${item.name} customization saved.` : `${item.name} added to your cart.`);
    setCustomizing(null);
  }

  function changeQuantity(item, change) {
    setCart((current) => setQuantity(current, item.id, (current.items[item.id] || 0) + change, catalog));
  }

  function removeItem(item) {
    setCart((current) => setQuantity(current, item.id, 0, catalog));
    setNotice(`${item.name} removed from your cart.`);
  }

  function changeSwipes(change) {
    setCart((current) => setSwipes(current, current.swipes + change, catalog));
  }

  return (
    <div className="menu-page">
      <a className="menu-skip" href="#menu-content" onClick={(event) => {
        event.preventDefault();
        document.getElementById('menu-content').focus();
      }}>Skip to menu</a>
      <header className="menu-header">
        <div className="menu-wordmark">The Pub<span>Vanderbilt · Student project</span></div>
        <div className="menu-header-actions">
          {email ? <span className="menu-account">Signed in as {email}</span> : null}
          {email && onViewOrders ? <button className="menu-text-button" onClick={onViewOrders}>My orders</button> : null}
          <button className="menu-text-button" onClick={onBack}>{email ? 'Back to login' : 'Sign in'}</button>
          <button className="menu-cart-link" onClick={showCart}>Cart <span>{summary.count}</span></button>
        </div>
      </header>

      <main id="menu-content" className="menu-content" tabIndex={-1}>
        <section className="menu-hero" aria-labelledby="menu-heading">
          <div>
            <p className="menu-eyebrow">Good food. Your pick.</p>
            <h1 id="menu-heading">What sounds good?</h1>
            <p>Find a favorite, add a side, and make it yours.</p>
          </div>
          <div className="menu-demo-note"><strong>Meal swipe menu</strong><span>Review your meal before ordering. One entrée, side, and drink per swipe.</span></div>
        </section>

        <CrowdMeter />
        {checkout ? <Checkout cart={cart} catalog={catalog} onBack={showCart} onSignIn={onBack} onAcceptChanges={acceptChanges} onEnsureCheckoutKey={ensureCheckoutKey} onOrderPlaced={orderPlaced} /> : <div className="menu-layout">
          <section className="menu-catalog" aria-label="Food and drinks">
            {loadState === 'ready' && <button className="menu-text-button" onClick={() => setAttempt((n) => n + 1)}>Refresh menu</button>}
            <label className="menu-search-label" htmlFor="menu-search">Find something delicious</label>
            <input id="menu-search" className="menu-search" type="search" placeholder="Search burgers, fries, drinks…" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="menu-categories" role="group" aria-label="Menu categories">
              {categories.map((name) => <button key={name} className="menu-category" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}
            </div>
            {loadState === 'loading' && <p role="status">Loading menu…</p>}
            {loadState === 'error' && <div role="alert"><p>{loadError}</p><button className="menu-add" onClick={() => setAttempt((n) => n + 1)}>Retry menu</button></div>}
            {loadState === 'ready' && catalog.length === 0 && <p role="status">No menu items are available yet. Please check back soon.</p>}
            <p className="menu-results" aria-live="polite">{visibleItems.length} {visibleItems.length === 1 ? 'item' : 'items'}{category !== 'All' ? ` in ${category.toLowerCase()}` : ' to choose from'}</p>
            <div className="menu-grid">
              {(loadState === 'ready' ? visibleItems : []).map((item) => {
                const itemQuantity = cart.items[item.id] || 0;
                const typeFull = summary.counts[item.swipeType] >= summary.swipes;
                return (
                  <article className="menu-item" key={item.id} aria-labelledby={`name-${item.id}`}>
                    <div className="menu-item-image">
                      <img
                        src={item.image ? `${MENU_IMAGE_BASE}${item.image}` : IMAGE_FALLBACK}
                        alt=""
                        loading="lazy"
                        onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_FALLBACK; }}
                      />
                    </div>
                    <div className="menu-item-top">
                      <span className="menu-item-category">{item.category}</span>
                      <div className="menu-item-markers">
                        {markersFor(item).map((marker) => <span
                          key={marker}
                          className={`menu-item-label ${PREFERENCE_MARKERS.has(marker) ? 'menu-item-label-preference' : 'menu-item-label-allergen'}`}
                        >{marker}</span>)}
                      </div>
                    </div>
                    <div className="menu-item-heading">
                      <h2 id={`name-${item.id}`}>{item.name}</h2>
                      <button type="button" className="menu-info" aria-label={`Nutrition facts for ${item.name}`} onClick={() => setDetails(item)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 11v6" />
                          <circle cx="12" cy="8" r="1" />
                        </svg>
                      </button>
                    </div>
                    {item.portion ? <p className="menu-item-portion">{item.portion}</p> : null}
                    {item.description ? <p>{item.description}</p> : null}
                    <div className="menu-item-bottom">
                      <span className="menu-item-swipe-type">{item.swipeType}</span>
                      {optionsFor(item).length > 0 ? (
                        <button type="button" className="menu-text-button menu-customize" disabled={!item.available} onClick={() => setCustomizing(item)}>
                          Customize
                        </button>
                      ) : null}
                      <button className="menu-add" aria-label={`Add ${item.name} to cart`} disabled={!item.available || typeFull} onClick={() => addItem(item)}>
                        {!item.available ? 'Sold out' : typeFull ? `${item.swipeType} limit reached` : '+ Add'}
                        {itemQuantity > 0 && !typeFull ? <span> · {itemQuantity} in cart</span> : null}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {loadState === 'ready' && catalog.length > 0 && visibleItems.length === 0 ? <div className="menu-no-results"><h2>No matches this time.</h2><p>Try another search or explore all categories.</p><button className="menu-text-button" onClick={() => { setQuery(''); setCategory('All'); }}>Reset filters</button></div> : null}
          </section>

          <aside id="cart" className="menu-cart" aria-labelledby="cart-title">
            <div className="menu-cart-heading"><h2 id="cart-title" tabIndex={-1}>Your cart <span>({summary.count})</span></h2>{summary.count > 0 ? <button className="menu-text-button" onClick={() => { setCart((current) => ({ ...current, items: {}, reviewedTypes: {}, customizations: {} })); setNotice('Cart cleared.'); }}>Clear cart</button> : null}</div>
            <div className="menu-swipe-control">
              <span className="menu-swipe-control-label">Meal swipes</span>
              <div className="menu-quantity" role="group" aria-label="Number of meal swipes">
                <button aria-label="Decrease meal swipes" disabled={summary.swipes <= minSwipesNeeded} onClick={() => changeSwipes(-1)}>−</button>
                <span aria-label="Meal swipes count">{summary.swipes}</span>
                <button aria-label="Increase meal swipes" disabled={summary.swipes >= MAX_SWIPES} onClick={() => changeSwipes(1)}>+</button>
              </div>
            </div>
            {summary.count === 0 ? <div className="menu-cart-empty"><span aria-hidden="true">＋</span><h3>A little hungry?</h3><p>Add something from the menu to start your cart.</p></div> : (
              <>
                <ul className="menu-cart-items">
                  {summary.items.map((item) => <li key={item.id}>
                    <div className="menu-cart-item-title">
                      <h3>{item.name}</h3>
                      <span className="menu-item-swipe-type">{item.swipeType}</span>
                    </div>
                    {item.customization ? <p className="menu-cart-customization">{item.customization}</p> : null}
                    <p className="menu-cart-item-portion">{item.portion}{loadState === 'ready' && !item.available ? ' Sold out — remove before checkout.' : ''}</p>
                    {optionsFor(item).length > 0 ? (
                      <button type="button" className="menu-text-button" onClick={() => setCustomizing(item)}>Customize {item.name}</button>
                    ) : null}
                    <div className="menu-cart-controls">
                      <div className="menu-quantity" role="group" aria-label={`Quantity for ${item.name}`}>
                        <button aria-label={`Decrease ${item.name} quantity`} onClick={() => changeQuantity(item, -1)}>−</button>
                        <span aria-label={`${item.name} quantity`}>{item.quantity}</span>
                        <button aria-label={`Increase ${item.name} quantity`} disabled={loadState !== 'ready' || !item.available || summary.counts[item.swipeType] >= summary.swipes} onClick={() => changeQuantity(item, 1)}>+</button>
                      </div>
                      <button className="menu-text-button" aria-label={`Remove ${item.name} from cart`} onClick={() => removeItem(item)}>Remove</button>
                    </div>
                  </li>)}
                </ul>
                <div className="menu-swipe-progress">
                  <span>Entries <strong>{summary.counts.Entry}/{summary.swipes}</strong></span>
                  <span>Sides <strong>{summary.counts.Side}/{summary.swipes}</strong></span>
                  <span>Drinks <strong>{summary.counts.Drink}/{summary.swipes}</strong></span>
                </div>
                <p className="menu-cart-footnote">Each meal swipe covers one entrée, one side, and one drink.</p>
              </>
            )}
            <button className="menu-add checkout-button" disabled={loadState !== 'ready' || summary.count === 0} onClick={() => { setNotice(''); setCheckout(true); }}>Review checkout</button>
            <p className="menu-save-note">{canSave ? `Cart saved on this browser. Up to ${MAX_SWIPES} meal swipes per order.` : 'Browser storage is unavailable. Your cart stays while you sign in, but will be lost if you refresh or close this tab.'}</p>
          </aside>
        </div>}
        <p className="menu-notice" role="status">{notice}</p>
        {customizing ? (
          <CustomizeDialog
            item={customizing}
            selected={cart.customizations?.[customizing.id] || []}
            inCart={Boolean(cart.items[customizing.id])}
            onClose={() => setCustomizing(null)}
            onSave={saveCustomization}
          />
        ) : null}
        {details ? <NutritionDialog item={details} onClose={() => setDetails(null)} /> : null}
      </main>
    </div>
  );
}
