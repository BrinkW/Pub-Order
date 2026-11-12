import { useEffect, useRef, useState } from 'react';
import Checkout from './Checkout.jsx';
import { CrowdMeter } from './CrowdMeter.jsx';
import CustomizeDialog from './CustomizeDialog.jsx';
import NutritionDialog from './NutritionDialog.jsx';
import { loadMenu } from './menu-api.js';
import { optionsFor } from './customizations.js';
import { CART_STORAGE_KEY, MAX_SWIPES, addToMeal, chooseNoSide, emptyCart, filterMenu, getCartSummary, restoreCart, setCustomizations, setQuantity, setSwipes, withCheckoutKey } from './cart.js';

const STEPS = [
  { id: 'entry', label: 'Entrée', type: 'Entry', search: 'Search entrées…' },
  { id: 'side', label: 'Side', type: 'Side', search: 'Search sides…' },
  { id: 'drink', label: 'Drink', type: 'Drink', search: 'Search drinks…' },
];
const NEXT_STEP = { entry: 'side', side: 'drink', drink: 'review' };

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
  const [step, setStep] = useState('entry');
  const focusOrderAfterRender = useRef(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [customizing, setCustomizing] = useState(null);
  const [details, setDetails] = useState(null);
  const [canSave, setCanSave] = useState(true);
  const summary = getCartSummary(cart, catalog);
  const currentStep = STEPS.find((candidate) => candidate.id === step);
  const visibleItems = filterMenu(query, 'All', currentStep ? catalog.filter((item) => item.swipeType === currentStep.type) : []);
  const showNoSide = step === 'side' && loadState === 'ready' && 'no side'.includes(query.trim().toLowerCase());
  const choiceCount = visibleItems.length + (showNoSide ? 1 : 0);
  const picked = Object.fromEntries(STEPS.map((candidate) => [candidate.id, summary.items.filter((item) => item.swipeType === candidate.type)]));
  const busiest = Math.max(summary.counts.Entry, summary.counts.Side, summary.counts.Drink);

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
    setStep('entry');
    setNotice('');
    onOrderPlaced?.(order);
  }

  function acceptChanges(result) {
    // Update only reviewed items; do not erase the rest of the catalog.
    const updates = new Map(result.items.map((item) => [item.id, item]));
    const unavailable = new Set(result.issues.filter((issue) => issue.code === 'unavailable').map((issue) => issue.id));
    setCatalog((current) => current.map((item) => ({ ...item, ...updates.get(item.id), ...(unavailable.has(item.id) ? { available: false } : {}) })));
    setCart((current) => ({ ...current, reviewedTypes: { ...current.reviewedTypes, ...Object.fromEntries(result.items.map((item) => [item.id, item.swipeType])) } }));
    setStep('entry');
    setNotice('The menu changed. Update your order, then check it again.');
  }

  function focusOrder() {
    document.getElementById('cart')?.scrollIntoView?.({ behavior: 'smooth' });
    document.getElementById('cart-title')?.focus({ preventScroll: true });
  }

  function showOrder() {
    if (step === 'review') { focusOrderAfterRender.current = true; setStep('entry'); }
    else focusOrder();
  }

  useEffect(() => {
    if (step !== 'review' && focusOrderAfterRender.current) {
      focusOrderAfterRender.current = false;
      focusOrder();
    }
  }, [step]);

  function goToStep(next) {
    setQuery('');
    setStep(next);
  }

  function chooseItem(item) {
    const next = addToMeal(cart, item, catalog);
    if (next === cart) {
      if (!cart.items[item.id]) {
        const word = cart.swipes === 1 ? { Entry: 'entrée', Side: 'side', Drink: 'drink' }[item.swipeType] : { Entry: 'entrées', Side: 'sides', Drink: 'drinks' }[item.swipeType];
        setNotice(`This order already has ${cart.swipes} ${word}.`);
      }
      return;
    }
    setCart(next);
    setNotice(`${item.name} added.`);
    if (getCartSummary(next, catalog).counts[item.swipeType] >= next.swipes) goToStep(NEXT_STEP[step]);
  }

  function removeOne(item) {
    setCart((current) => setQuantity(current, item.id, (current.items[item.id] || 1) - 1, catalog));
  }

  function changeSwipes(swipes) {
    setCart((current) => setSwipes(current, swipes, catalog));
  }

  function skipSide() {
    setCart((current) => chooseNoSide(current, catalog));
    setNotice('No side added.');
    goToStep('drink');
  }

  function saveCustomization(optionIds) {
    const item = customizing;
    if (!item) return;
    setCart((current) => {
      const withItem = current.items[item.id] ? current : addToMeal(current, item, catalog);
      if (!withItem.items[item.id]) return current;
      return setCustomizations(withItem, item, optionIds);
    });
    setNotice(cart.items[item.id] ? `${item.name} customization saved.` : `${item.name} added.`);
    setCustomizing(null);
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
          <button className="menu-cart-link" onClick={showOrder}>Your meal <span>{summary.count}</span></button>
        </div>
      </header>

      <main id="menu-content" className="menu-content" tabIndex={-1}>
        <section className="menu-hero" aria-labelledby="menu-heading">
          <div>
            <p className="menu-eyebrow">Good food. Your pick.</p>
            <h1 id="menu-heading">What sounds good?</h1>
          </div>
          <div className="menu-demo-note"><strong>Meal swipes</strong><span>Each swipe needs an entrée and a drink. Add that many before the next step. A side is optional.</span></div>
        </section>

        <CrowdMeter />
        <nav className="order-pipeline" aria-label="Order steps">
          {[...STEPS, { id: 'review', label: 'Review' }].map((candidate, index, steps) => {
            const currentIndex = steps.findIndex((item) => item.id === step);
            return (
              <div className="order-pipeline-item" key={candidate.id}>
                {index > 0 ? <span className={`order-pipeline-line${index <= currentIndex ? ' is-done' : ''}`} aria-hidden="true" /> : null}
                <button
                  type="button"
                  className={`order-pipeline-step${index < currentIndex ? ' is-done' : ''}`}
                  aria-current={step === candidate.id ? 'step' : undefined}
                  disabled={candidate.id === 'review' && picked.entry.length === 0}
                  onClick={() => goToStep(candidate.id)}
                >
                  <span className="order-pipeline-index" aria-hidden="true">{index + 1}</span>
                  {candidate.label}
                </button>
              </div>
            );
          })}
        </nav>

        {step === 'review' ? <Checkout cart={cart} catalog={catalog} onBack={() => goToStep('drink')} onSignIn={onBack} onAcceptChanges={acceptChanges} onEnsureCheckoutKey={ensureCheckoutKey} onOrderPlaced={orderPlaced} /> : <div className="menu-layout">
          <section className="menu-catalog" aria-label={currentStep.label}>
            <input id="menu-search" className="menu-search" type="search" aria-label={currentStep.search} placeholder={currentStep.search} value={query} onChange={(event) => setQuery(event.target.value)} />
            {loadState === 'loading' && <p role="status">Loading menu…</p>}
            {loadState === 'error' && <div role="alert"><p>{loadError}</p><button className="menu-add" onClick={() => setAttempt((n) => n + 1)}>Retry menu</button></div>}
            {loadState === 'ready' && catalog.length === 0 && <p role="status">No menu items are available yet. Please check back soon.</p>}
            <p className="menu-results" aria-live="polite">{choiceCount} {choiceCount === 1 ? 'choice' : 'choices'}</p>
            <div className="menu-grid">
              {(loadState === 'ready' ? visibleItems : []).map((item) => {
                const quantity = cart.items[item.id] || 0;
                const typeFull = summary.counts[item.swipeType] >= cart.swipes;
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
                      {optionsFor(item).length > 0 ? (
                        <button type="button" className="menu-text-button menu-customize" disabled={!item.available} onClick={() => setCustomizing(item)}>
                          Customize
                        </button>
                      ) : null}
                      {quantity > 0 && cart.swipes > 1 ? (
                        <div className="menu-quantity">
                          <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => removeOne(item)}>−</button>
                          <span>{quantity}</span>
                          <button type="button" aria-label={`Add ${item.name}`} disabled={!item.available || typeFull} onClick={() => chooseItem(item)}>+</button>
                        </div>
                      ) : (
                        <button className="menu-add" aria-label={`Add ${item.name}`} aria-pressed={quantity > 0} disabled={!item.available} onClick={() => chooseItem(item)}>
                          {!item.available ? 'Sold out' : quantity > 0 ? 'Added' : '+ Add'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
              {showNoSide ? (
                <article className="menu-item" aria-labelledby="name-no-side">
                  <div className="menu-item-image menu-no-side-image" aria-hidden="true"><span>None</span></div>
                  <div className="menu-item-top"><span className="menu-item-category">Side</span></div>
                  <div className="menu-item-heading"><h2 id="name-no-side">No side</h2></div>
                  <p>Leave this part of the meal out.</p>
                  <div className="menu-item-bottom">
                    <button className="menu-add" aria-label="Add No side" aria-pressed={Boolean(cart.noSide) && picked.side.length === 0} onClick={skipSide}>
                      {cart.noSide && picked.side.length === 0 ? 'Added' : '+ Add'}
                    </button>
                  </div>
                </article>
              ) : null}
            </div>
            {loadState === 'ready' && catalog.length > 0 && choiceCount === 0 ? <div className="menu-no-results"><h2>No matches this time.</h2><p>Try a different search.</p><button className="menu-text-button" onClick={() => setQuery('')}>Clear search</button></div> : null}
          </section>

          <aside id="cart" className="menu-cart" aria-labelledby="cart-title">
            <div className="menu-cart-heading"><h2 id="cart-title" tabIndex={-1}>Your meal <span>({summary.count})</span></h2>{summary.count > 0 ? <button className="menu-text-button" onClick={() => { setCart(emptyCart()); setNotice('Order cleared.'); goToStep('entry'); }}>Clear order</button> : null}</div>
            <div className="menu-swipe-control">
              <span className="menu-swipe-control-label" id="swipe-label">Meal swipes</span>
              <div className="menu-quantity" role="group" aria-labelledby="swipe-label">
                <button type="button" aria-label="Fewer meal swipes" disabled={cart.swipes <= 1 || busiest >= cart.swipes} onClick={() => changeSwipes(cart.swipes - 1)}>−</button>
                <span>{cart.swipes}</span>
                <button type="button" aria-label="More meal swipes" disabled={cart.swipes >= MAX_SWIPES} onClick={() => changeSwipes(cart.swipes + 1)}>+</button>
              </div>
            </div>
            <ul className="menu-cart-items">
              {STEPS.map((candidate) => {
                const items = picked[candidate.id];
                return <li key={candidate.id}>
                  <div className="menu-cart-item-title">
                    <h3>{candidate.label}</h3>
                    <button type="button" className="menu-text-button" onClick={() => goToStep(candidate.id)}>Change</button>
                  </div>
                  {cart.swipes > 1 ? <p className="menu-cart-item-portion">{summary.counts[candidate.type]} of {cart.swipes}</p> : null}
                  {items.length > 0 ? items.map((item) => <div key={item.id}>
                    <p className="menu-cart-customization">{item.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}{item.customization ? ` · ${item.customization}` : ''}</p>
                    {loadState === 'ready' && !item.available ? <p className="menu-cart-item-portion">Sold out. Pick something else.</p> : null}
                  </div>) : <p className="menu-cart-item-portion">{candidate.id === 'side' ? (cart.noSide ? 'No side' : 'No side yet') : 'Not chosen yet'}</p>}
                </li>;
              })}
            </ul>
            <button className="menu-add checkout-button" disabled={loadState !== 'ready' || picked.entry.length === 0} onClick={() => goToStep('review')}>Look over your order</button>
            {canSave ? null : <p className="menu-save-note">Browser storage is unavailable. Your order stays while you sign in, but will be lost if you refresh or close this tab.</p>}
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
