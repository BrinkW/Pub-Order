// Order history (US2, built on Sprint 3's US6 list): every order the signed-in student has
// placed, newest first, with when it was placed, what was in it, its total and its status.
// Orders load a page at a time; "Load older orders" asks for the page before the oldest one
// shown, by its createdAt and id, so orders placed at the same instant are never skipped.
import { useEffect, useRef, useState } from 'react';
import PubHeader from './PubHeader.jsx';
import { HISTORY_PAGE_SIZE, loadOrders } from './order-api.js';
import { formatPlacedAt, isOpenOrder, shortOrderId, stepLabel, swipeLabel } from './order-status.js';

export default function MyOrders({ email, onOpenOrder, onBackToMenu, onSignIn }) {
  const [orders, setOrders] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState('');
  const heading = useRef(null);
  const olderRequest = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    olderRequest.current?.abort();
    setState('loading'); setError(''); setOlderError(''); setLoadingOlder(false);
    loadOrders(controller.signal, { limit: HISTORY_PAGE_SIZE }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.signInRequired) { setState('signIn'); return; }
      setOrders(result.orders); setState('ready');
      setHasOlder(result.orders.length === HISTORY_PAGE_SIZE);
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      setError(failure.message); setState('error');
    });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => { if (state !== 'loading') heading.current?.focus(); }, [state]);
  useEffect(() => () => olderRequest.current?.abort(), []);

  async function loadOlder() {
    const oldest = orders[orders.length - 1];
    if (!oldest?.createdAt || loadingOlder) return;
    olderRequest.current = new AbortController();
    setLoadingOlder(true); setOlderError('');
    try {
      const result = await loadOrders(olderRequest.current.signal, {
        limit: HISTORY_PAGE_SIZE, before: oldest.createdAt, beforeId: oldest.id,
      });
      if (result.signInRequired) { setState('signIn'); return; }
      // The server pages by (createdAt, id), so pages don't overlap; this only guards against
      // showing an order twice if the list changed between requests.
      setOrders((current) => {
        const shown = new Set(current.map((order) => order.id));
        return [...current, ...result.orders.filter((order) => !shown.has(order.id))];
      });
      setHasOlder(result.orders.length === HISTORY_PAGE_SIZE);
    } catch (failure) {
      if (failure.name !== 'AbortError') setOlderError(failure.message);
    } finally {
      setLoadingOlder(false);
    }
  }

  const current = orders.filter(isOpenOrder);
  const past = orders.filter((order) => !isOpenOrder(order));

  return (
    <div className="menu-page order-page">
      <PubHeader email={email}>
        <button className="menu-cart-link" onClick={onBackToMenu}>Back to menu</button>
      </PubHeader>
      <main className="menu-content order-content">
        <section className="order-hero">
          <p className="menu-eyebrow">Pickup tracking</p>
          <h1 ref={heading} tabIndex={-1}>{state === 'signIn' ? 'Sign in to see your orders' : 'My orders'}</h1>
          {state === 'ready' && orders.length > 0 && <p className="order-history-note">Newest first. Open any order to see its full receipt and status.</p>}
        </section>

        {state === 'loading' && <p role="status">Loading your orders…</p>}
        {state === 'signIn' && <button className="menu-add" onClick={onSignIn}>Sign in</button>}
        {state === 'error' && <div className="order-message" role="alert">
          <p>{error}</p>
          <button className="menu-add" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>}
        {state === 'ready' && orders.length === 0 && <div className="order-message">
          <p>You haven’t placed any orders yet.</p>
          <button className="menu-add" onClick={onBackToMenu}>Browse the menu</button>
        </div>}
        {state === 'ready' && current.length > 0 && <OrderGroup title="In progress" orders={current} onOpenOrder={onOpenOrder} />}
        {/* Picked up and cancelled orders both land here; each row's chip says which. */}
        {state === 'ready' && past.length > 0 && <OrderGroup title="Past orders" orders={past} onOpenOrder={onOpenOrder} />}
        {state === 'ready' && hasOlder && <div className="order-history-more">
          <button className="menu-add" disabled={loadingOlder} onClick={loadOlder}>{loadingOlder ? 'Loading older orders…' : 'Load older orders'}</button>
          {olderError && <p className="order-refresh-error" role="alert">{olderError}</p>}
        </div>}
        {state === 'ready' && orders.length > 0 && <button className="menu-text-button" onClick={() => setAttempt((n) => n + 1)}>Refresh list</button>}
      </main>
    </div>
  );
}

function OrderGroup({ title, orders, onOpenOrder }) {
  const id = `orders-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className="order-group" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul className="order-list">
        {orders.map((order) => <li key={order.id} className={`order-row order-row-${order.status.toLowerCase()}`}>
          <div className="order-row-main">
            <strong>Order #{shortOrderId(order.id)}</strong>
            <span>{order.items.map((item) => `${item.name} × ${item.quantity}${item.customization ? ` (${item.customization})` : ''}`).join(', ')}</span>
            <span className="order-row-meta">
              {order.createdAt ? <time dateTime={order.createdAt}>Placed {formatPlacedAt(order.createdAt)}</time> : null}
              {order.createdAt ? ' · ' : ''}Total: {swipeLabel(order.swipes)}
            </span>
          </div>
          <span className="order-chip">{stepLabel(order.status)}</span>
          <button className="menu-add" aria-label={`View order ${shortOrderId(order.id)}`} onClick={() => onOpenOrder(order.id)}>View</button>
        </li>)}
      </ul>
    </section>
  );
}
