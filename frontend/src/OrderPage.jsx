// US4 order confirmation and US6 pickup tracking for one saved order.
// The page always reads the order back from the server, so a refresh (or opening the link
// later) shows the stored order and its latest status, never a copy kept in the browser.
import { useCallback, useEffect, useRef, useState } from 'react';
import PubHeader from './PubHeader.jsx';
import { cancelOrder, loadOrder } from './order-api.js';
import {
  CANCELLED, STATUS_POLL_MS, canCancel, formatPlacedAt, isOpenOrder, shortOrderId, statusMessage, statusSteps,
  stepLabel, swipeLabel,
} from './order-status.js';

export default function OrderPage({ orderId, initialOrder, justPlaced, email, onBackToMenu, onViewOrders, onSignIn }) {
  const startingOrder = initialOrder?.id === orderId ? initialOrder : null;
  const [order, setOrder] = useState(startingOrder);
  const [state, setState] = useState(startingOrder ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const latestRequest = useRef(0);
  const lastStatus = useRef(startingOrder?.status ?? null);
  const controller = useRef(null);
  const heading = useRef(null);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    const request = ++latestRequest.current;
    controller.current?.abort();
    controller.current = new AbortController();
    if (!quiet) setRefreshing(true);
    try {
      const result = await loadOrder(orderId, controller.current.signal);
      if (request !== latestRequest.current) return;
      setError('');
      if (result.signInRequired) { setState('signIn'); return; }
      if (result.notFound) { setOrder(null); setState('notFound'); return; }
      const saved = result.order;
      if (lastStatus.current && lastStatus.current !== saved.status) {
        setAnnouncement(`Your order is now ${stepLabel(saved.status).toLowerCase()}.`);
      }
      lastStatus.current = saved.status;
      setOrder(saved);
      setState('ready');
      setCheckedAt(new Date());
    } catch (failure) {
      if (request !== latestRequest.current || failure.name === 'AbortError') return;
      // Keep showing the last status we loaded; only a page with nothing to show is an error page.
      setError(failure.message);
      setState((current) => (current === 'ready' ? 'ready' : 'error'));
    } finally {
      if (request === latestRequest.current) setRefreshing(false);
    }
  }, [orderId]);

  // Load (or reload) whenever the page opens a different order.
  useEffect(() => {
    refresh({ quiet: true });
    return () => { latestRequest.current += 1; controller.current?.abort(); };
  }, [refresh]);

  // Check for a newer status while the order is still open and the tab is visible.
  const open = state === 'ready' && isOpenOrder(order);
  useEffect(() => {
    if (!open) return undefined;
    const poll = () => { if (!document.hidden) refresh({ quiet: true }); };
    const timer = setInterval(poll, STATUS_POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [open, refresh]);

  // A student with the tab in the background can still see that pickup is ready.
  const ready = order?.status === 'Ready';
  useEffect(() => {
    if (!ready) return undefined;
    const previous = document.title;
    document.title = 'Ready for pickup · Pub-Order';
    return () => { document.title = previous; };
  }, [ready]);

  useEffect(() => { if (state !== 'loading') heading.current?.focus(); }, [state]);

  async function cancel() {
    if (!window.confirm('Cancel this order? The kitchen will not make it.')) return;
    setCancelling(true);
    setCancelError('');
    try {
      const result = await cancelOrder(orderId);
      if (result.signInRequired) { setState('signIn'); return; }
      if (result.notFound) { setOrder(null); setState('notFound'); return; }
      if (result.tooLate) {
        setCancelError('The kitchen has already started this order, so it can’t be cancelled.');
        await refresh({ quiet: true });
        return;
      }
      lastStatus.current = result.order.status;
      setOrder(result.order);
      setAnnouncement('Your order was cancelled.');
    } catch (failure) {
      setCancelError(failure.message);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="menu-page order-page">
      <PubHeader email={email}>
        <button className="menu-text-button" onClick={onViewOrders}>My orders</button>
        <button className="menu-cart-link" onClick={onBackToMenu}>Back to menu</button>
      </PubHeader>
      <main className="menu-content order-content">
        {state === 'loading' && <p role="status">Loading your order…</p>}

        {state === 'signIn' && <section className="order-message">
          <h1 ref={heading} tabIndex={-1}>Sign in to see this order</h1>
          <p>Orders are only shown to the student who placed them.</p>
          <button className="menu-add" onClick={onSignIn}>Sign in</button>
        </section>}

        {state === 'notFound' && <section className="order-message">
          <h1 ref={heading} tabIndex={-1}>We couldn’t find that order</h1>
          <p>It may be a mistyped link, or an order from a different account.</p>
          <div className="order-actions">
            <button className="menu-add" onClick={onViewOrders}>See my orders</button>
            <button className="menu-text-button" onClick={onBackToMenu}>Back to menu</button>
          </div>
        </section>}

        {state === 'error' && <section className="order-message" role="alert">
          <h1 ref={heading} tabIndex={-1}>Your order didn’t load</h1>
          <p>{error}</p>
          <button className="menu-add" disabled={refreshing} onClick={() => refresh()}>{refreshing ? 'Trying again…' : 'Try again'}</button>
        </section>}

        {state === 'ready' && order && <OrderDetails
          order={order} justPlaced={justPlaced} heading={heading} error={error} checkedAt={checkedAt}
          refreshing={refreshing} onRefresh={() => refresh()} onBackToMenu={onBackToMenu} onViewOrders={onViewOrders}
          cancelling={cancelling} cancelError={cancelError} onCancel={cancel}
        />}

        <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
      </main>
    </div>
  );
}

function OrderDetails({
  order, justPlaced, heading, error, checkedAt, refreshing, onRefresh, onBackToMenu, onViewOrders,
  cancelling, cancelError, onCancel,
}) {
  const message = statusMessage(order.status);
  const number = shortOrderId(order.id);
  return <>
    <section className="order-hero" aria-labelledby="order-heading">
      <p className="menu-eyebrow">{justPlaced ? 'Thanks, your order is in' : 'Pickup tracking'}</p>
      <h1 id="order-heading" ref={heading} tabIndex={-1}>{justPlaced ? 'Order received' : 'Your order'}</h1>
      <p className="order-number">Order number <strong>#{number}</strong></p>
    </section>

    <div className="order-layout">
      <section className={`order-status order-status-${order.status.toLowerCase()}`} aria-labelledby="order-status-title">
        <p className="order-status-label">Pickup status</p>
        <h2 id="order-status-title">{message.title}</h2>
        <p className="order-status-detail">{message.detail}</p>
        {order.status !== CANCELLED && <ol className="order-steps" aria-label="Order progress">
          {statusSteps(order.status).map((step) => (
            <li key={step.status} className={`order-step order-step-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}>
              <span className="order-step-dot" aria-hidden="true" />
              <span className="order-step-label">{step.label}</span>
              <span className="visually-hidden">{step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (current)' : ''}</span>
            </li>
          ))}
        </ol>}
        <div className="order-status-meta">
          <span>{checkedAt ? `Checked ${checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'Checking for updates…'}{isOpenOrder(order) ? ' · updates automatically' : ''}</span>
          <button className="order-refresh" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh status'}</button>
        </div>
        {error && <p className="order-refresh-error" role="alert">Couldn’t refresh just now, so this is the last status we loaded. {error}</p>}
      </section>

      <section className="order-receipt" aria-labelledby="order-summary-title">
        <h2 id="order-summary-title">Order summary</h2>
        <ul className="order-receipt-items">
          {order.items.map((item) => <li key={item.id}>
            <span>{item.name}{item.customization ? <span className="order-receipt-note"> · {item.customization}</span> : null}</span>
            <span className="order-receipt-type">{item.swipeType}</span>
            <span className="order-receipt-qty">× {item.quantity}</span>
          </li>)}
        </ul>
        <div className="order-receipt-total"><span>Total</span><strong>{swipeLabel(order.swipes)}</strong></div>
        {order.createdAt ? <p className="order-receipt-placed">Placed {formatPlacedAt(order.createdAt)}</p> : null}
      </section>
    </div>

    {cancelError && <p className="order-refresh-error" role="alert">{cancelError}</p>}
    <div className="order-actions">
      <button className="menu-add" onClick={onBackToMenu}>Order something else</button>
      <button className="menu-text-button" onClick={onViewOrders}>View all my orders</button>
      {canCancel(order) && <button className="menu-text-button" disabled={cancelling} onClick={onCancel}>
        {cancelling ? 'Cancelling…' : 'Cancel order'}
      </button>}
    </div>
  </>;
}
