import { useCallback, useEffect, useRef, useState } from 'react';
import Kitchen from './Kitchen.jsx';
import Login from './Login.jsx';
import Menu from './Menu.jsx';
import MyOrders from './MyOrders.jsx';
import OrderNotices from './OrderNotices.jsx';
import OrderPage from './OrderPage.jsx';
import { getSupabase } from './supabase.js';
import { useOrderNotifications } from './useOrderNotifications.js';
import './menu.css';
import './orders.css';

// Pages live in the URL hash so a refresh or a shared link reopens the same page:
// #menu, #orders, #order/<order id>; anything else is the login page.
export function pageFromHash(hash) {
  const value = hash.replace(/^#/, '');
  if (value === 'menu') return { name: 'menu' };
  if (value === 'orders') return { name: 'orders' };
  if (value === 'kitchen') return { name: 'kitchen' };
  const order = /^order\/([^/?#]+)$/.exec(value);
  if (order) return { name: 'order', orderId: decodeURIComponent(order[1]) };
  return { name: 'login' };
}

const hashFor = (page) => (page.name === 'order' ? `order/${encodeURIComponent(page.orderId)}` : page.name);

export default function App() {
  const [page, setPage] = useState(() => pageFromHash(window.location.hash));
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');
  // US4: order updates shown in the corner, and the latest one, so an open order page re-reads.
  const [notices, setNotices] = useState([]);
  const [liveUpdate, setLiveUpdate] = useState(null);
  const [accountChecked, setAccountChecked] = useState(false);
  // The order Checkout just saved, shown at once while the page re-reads it from the server.
  const [placedOrder, setPlacedOrder] = useState(null);
  // Where to go after signing in, when an order page asked the student to sign in first.
  const [afterSignIn, setAfterSignIn] = useState(null);

  useEffect(() => {
    const followHash = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  useEffect(() => {
    const client = getSupabase();
    if (!client) {
      setAccountChecked(true);
      return undefined;
    }
    let active = true;
    async function apply(session) {
      if (!session) {
        if (active) { setEmail(''); setUserId(''); setRole(''); setNotices([]); setAccountChecked(true); }
        return;
      }
      if (active) { setEmail(session.user?.email || ''); setUserId(session.user?.id || ''); }
      try {
        const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const profile = response.ok ? await response.json() : {};
        if (!active) return;
        setEmail(profile.email || session.user?.email || '');
        setRole(profile.role === 'kitchen' ? 'kitchen' : 'student');
      } catch {
        if (active) setRole('student');
      } finally {
        if (active) setAccountChecked(true);
      }
    }
    client.auth.getSession().then(({ data }) => apply(data?.session)).catch(() => { if (active) setAccountChecked(true); });
    const { data } = client.auth.onAuthStateChange((_event, session) => { apply(session); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const navigate = useCallback((next) => {
    const target = typeof next === 'string' ? { name: next } : next;
    window.location.hash = hashFor(target);
    setPage(target);
    window.scrollTo?.(0, 0);
  }, []);

  useEffect(() => {
    if (!accountChecked || page.name !== 'kitchen' || role === 'kitchen') return;
    navigate(role === 'student' ? 'menu' : 'login');
  }, [accountChecked, page.name, role, navigate]);

  useEffect(() => {
    if (role !== 'kitchen' || page.name === 'kitchen' || page.name === 'login') return;
    navigate('kitchen');
  }, [role, page.name, navigate]);

  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);

  const notifications = useOrderNotifications({
    userId,
    enabled: role === 'student',
    onNotice: (notice) => {
      setLiveUpdate({ orderId: notice.orderId, status: notice.status });
      // The order page already shows its own status change, so no corner notice for that order.
      const current = pageRef.current;
      if (current.name === 'order' && current.orderId === notice.orderId) return;
      // A newer notice for an order replaces the older one; at most three stay on screen.
      setNotices((shown) => [notice, ...shown.filter((item) => item.orderId !== notice.orderId)].slice(0, 3));
    },
    onOpenOrder: (orderId) => openOrder(orderId),
  });

  function signInThenReturn() {
    setAfterSignIn(page);
    navigate('login');
  }

  const openOrder = (orderId) => {
    setPlacedOrder(null);
    setNotices((shown) => shown.filter((item) => item.orderId !== orderId));
    navigate({ name: 'order', orderId });
  };

  return <>
    {/* The menu stays mounted so the cart and search survive visits to other pages. */}
    <div hidden={page.name !== 'menu'}><Menu
      email={email}
      onBack={() => navigate('login')}
      onViewOrders={() => navigate('orders')}
      onOrderPlaced={(order) => { setPlacedOrder(order); notifications.track(order); navigate({ name: 'order', orderId: order.id }); }}
    /></div>
    {page.name === 'order' && <OrderPage
      key={page.orderId}
      orderId={page.orderId}
      initialOrder={placedOrder}
      justPlaced={placedOrder?.id === page.orderId}
      email={email}
      liveUpdate={liveUpdate}
      onBackToMenu={() => navigate('menu')}
      onViewOrders={() => navigate('orders')}
      onSignIn={signInThenReturn}
    />}
    {page.name === 'orders' && <MyOrders
      email={email}
      onOpenOrder={openOrder}
      onBackToMenu={() => navigate('menu')}
      onSignIn={signInThenReturn}
    />}
    {role === 'kitchen' && page.name === 'kitchen' && <Kitchen
      email={email}
      onSignOut={async () => {
        await getSupabase()?.auth.signOut();
        setEmail('');
        setUserId('');
        setRole('');
        navigate('login');
      }}
    />}
    {page.name === 'login' && <Login onBrowse={() => navigate('menu')} onSignedIn={(account) => {
      setEmail(account.email);
      setRole(account.role);
      navigate(account.role === 'kitchen' ? 'kitchen' : (afterSignIn ?? 'menu'));
      setAfterSignIn(null);
    }} />}
    {role === 'student' && page.name !== 'login' && <OrderNotices
      notices={notices}
      onOpen={(notice) => openOrder(notice.orderId)}
      onDismiss={(notice) => setNotices((shown) => shown.filter((item) => item.id !== notice.id))}
    />}
  </>;
}
