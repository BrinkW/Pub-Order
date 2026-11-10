import { useEffect, useId, useRef, useState } from 'react';
import { checkoutErrors, getCartSummary } from './cart.js';
import { placeOrder, reviewCart } from './menu-api.js';

export default function Checkout({ cart, catalog, onBack, onSignIn, onAcceptChanges, onEnsureCheckoutKey, onOrderPlaced }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [signInRequired, setSignInRequired] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [closedProblem, setClosedProblem] = useState('');
  const activeRequest = useRef(0);
  const heading = useRef(null);
  const problemTitle = useId();
  useEffect(() => { heading.current?.focus(); }, []);
  const summary = getCartSummary(cart, catalog);
  const errors = checkoutErrors(cart, catalog);
  // Adding a checkout key doesn't change the meal, so it must not reset the review.
  const meal = JSON.stringify([cart.swipes, cart.items, cart.reviewedTypes, cart.customizations]);

  function reviewCurrent() {
    if (checkoutErrors(cart, catalog).length) { setChecking(false); return; }
    const request = ++activeRequest.current;
    setClosedProblem('');
    setChecking(true); setResult(null); setError(''); setSignInRequired(false);
    reviewCart(cart, catalog).then((review) => {
      if (request !== activeRequest.current) return null;
      if (review.signInRequired) { setSignInRequired(true); return null; }
      setResult(review);
      return review;
    }).catch((failure) => {
      if (request === activeRequest.current) setError(failure.message);
      return null;
    }).finally(() => {
      if (request === activeRequest.current) setChecking(false);
    });
  }

  useEffect(() => {
    setResult(null); setError(''); setSignInRequired(false); setPlacing(false);
    reviewCurrent();
    return () => { activeRequest.current += 1; };
    // Review again whenever the meal or the menu changes. The checkout key is not part of the meal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal, catalog]);

  async function submit() {
    if (placing || checking || errors.length || signInRequired || (result && !result.canSubmit)) return;
    let review = result?.canSubmit ? result : null;
    if (!review) {
      const request = ++activeRequest.current;
      setClosedProblem('');
      setChecking(true); setError(''); setSignInRequired(false);
      try {
        const next = await reviewCart(cart, catalog);
        if (request !== activeRequest.current) return;
        if (next.signInRequired) { setSignInRequired(true); return; }
        setResult(next);
        if (!next.canSubmit) return;
        review = next;
      } catch (failure) {
        if (request === activeRequest.current) setError(failure.message);
        return;
      } finally {
        if (request === activeRequest.current) setChecking(false);
      }
    }
    const keyed = onEnsureCheckoutKey ? onEnsureCheckoutKey() : cart;
    const request = ++activeRequest.current;
    setClosedProblem('');
    setPlacing(true); setError(''); setSignInRequired(false);
    try {
      const outcome = await placeOrder(keyed, catalog);
      if (outcome.order) {
        // A saved order must reach Menu even if Back unmounts this review.
        onOrderPlaced?.(outcome.order, keyed.checkoutKey);
        return;
      }
      if (request !== activeRequest.current) return;
      const latest = outcome.issues ? await reviewCart(keyed, catalog) : outcome;
      if (request !== activeRequest.current) return;
      if (latest.signInRequired) setSignInRequired(true);
      else setResult(latest);
    } catch (failure) {
      if (request === activeRequest.current) setError(failure.message);
    } finally {
      if (request === activeRequest.current) setPlacing(false);
    }
  }

  const cannotPlace = checking || placing || errors.length > 0 || signInRequired || Boolean(result && !result.canSubmit) || (!result?.canSubmit && !error);
  const problemKey = JSON.stringify([errors, error, signInRequired, result?.issues || []]);
  const hasProblem = errors.length > 0 || Boolean(error) || signInRequired || Boolean(result?.issues.length);
  const showProblem = hasProblem && !checking && !placing && closedProblem !== problemKey;

  useEffect(() => {
    if (!showProblem) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') setClosedProblem(problemKey);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showProblem, problemKey]);

  const partName = { Entry: 'Entrée', Side: 'Side', Drink: 'Drink' };
  return <section className="checkout-review" aria-labelledby="checkout-title">
    <h2 id="checkout-title" ref={heading} tabIndex={-1}>Look over your order</h2>
    <p>Each meal swipe needs an entrée and a drink. A side is optional. This uses {cart.swipes} meal {cart.swipes === 1 ? 'swipe' : 'swipes'}.</p>
    <ul className="menu-cart-items">
      {summary.items.map((item) => <li key={item.id}><strong>{item.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</strong><span>{partName[item.swipeType] || item.swipeType}{item.customization ? ` · ${item.customization}` : ''}</span></li>)}
    </ul>
    <div className="menu-subtotal"><span>Total</span><strong>{cart.swipes} meal {cart.swipes === 1 ? 'swipe' : 'swipes'}</strong></div>
    {showProblem && <div className="customize-backdrop" onMouseDown={() => setClosedProblem(problemKey)}>
      <section className="customize-dialog order-problem" role="dialog" aria-modal="true" aria-labelledby={problemTitle} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id={problemTitle}>{signInRequired && errors.length === 0 && !error && !result?.issues.length ? 'Sign in to continue' : 'This order needs a change'}</h2>
        {errors.length > 0 && <ul role="alert">{errors.map((message) => <li key={message}>{message}</li>)}</ul>}
        {error && <p role="alert">{error}</p>}
        {signInRequired && <p role="alert">Sign in to continue. Your cart will stay here.</p>}
        {result?.issues.length > 0 && <div role="alert"><h3>The menu changed</h3><ul>{result.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div>}
        <div className="customize-actions">
          <button type="button" className="menu-text-button" onClick={() => setClosedProblem(problemKey)}>Close</button>
          {signInRequired && <button className="menu-add" onClick={onSignIn}>Sign in and keep cart</button>}
          {result?.issues.length > 0 && <button className="menu-add" onClick={() => onAcceptChanges(result)}>Update my order</button>}
        </div>
      </section>
    </div>}
    <div className="checkout-actions">
      <button className="menu-text-button" onClick={onBack}>Back</button>
      <button className="menu-add" disabled={cannotPlace} onClick={submit}>{placing ? 'Placing order…' : 'Place order'}</button>
    </div>
  </section>;
}
