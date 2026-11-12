// US4: watch the signed-in student's orders from any page and report each status change once.
//
// Supabase Realtime pushes order updates as soon as the kitchen saves them. Row-level security
// decides which rows a subscriber receives, so a student only ever hears about their own orders.
// If Realtime isn't connected (blocked network, project without Realtime, local plain Postgres),
// the hook polls the order list instead while the student has an order in progress.
import { useCallback, useEffect, useRef, useState } from 'react';
import { HISTORY_PAGE_SIZE, loadOrders } from './order-api.js';
import { createStatusTracker, showBrowserNotification, statusChangeFrom } from './order-notifications.js';
import { STATUS_POLL_MS } from './order-status.js';
import { getSupabase } from './supabase.js';

export function useOrderNotifications({ userId, enabled, onNotice, onOpenOrder }) {
  const tracker = useRef(createStatusTracker());
  const [live, setLive] = useState(false);
  const [watching, setWatching] = useState(false);
  // Read the latest callbacks without resubscribing every render.
  const callbacks = useRef({ onNotice, onOpenOrder });
  useEffect(() => { callbacks.current = { onNotice, onOpenOrder }; });

  const active = Boolean(enabled && userId);

  const handle = useCallback((row, options) => {
    const change = statusChangeFrom(row, userId);
    if (!change) return;
    const notice = tracker.current.change(change.orderId, change.status, options);
    setWatching(tracker.current.hasOpenOrders());
    if (!notice) return;
    callbacks.current.onNotice?.(notice);
    showBrowserNotification(notice, (orderId) => callbacks.current.onOpenOrder?.(orderId));
  }, [userId]);

  const poll = useCallback(async (signal) => {
    try {
      const result = await loadOrders(signal, { limit: HISTORY_PAGE_SIZE });
      if (signal?.aborted || !result.orders) return;
      result.orders.forEach((order) => handle(order));
    } catch {
      // A failed poll is retried on the next tick; the order page shows its own errors.
    }
  }, [handle]);

  // A new account (or signing out) starts from a clean slate, then learns the current statuses
  // without notifying about them.
  useEffect(() => {
    tracker.current = createStatusTracker();
    setWatching(false);
    if (!active) return undefined;
    const controller = new AbortController();
    loadOrders(controller.signal, { limit: HISTORY_PAGE_SIZE }).then((result) => {
      if (controller.signal.aborted || !result.orders) return;
      tracker.current.seed(result.orders);
      setWatching(tracker.current.hasOpenOrders());
    }).catch(() => {});
    return () => controller.abort();
  }, [active, userId]);

  // Realtime subscription to this student's order updates.
  useEffect(() => {
    setLive(false);
    const client = getSupabase();
    if (!active || typeof client?.channel !== 'function') return undefined;
    const channel = client.channel(`order-updates:${userId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
        (payload) => handle(payload.new, { unknownIsNew: true }))
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => { setLive(false); client.removeChannel(channel); };
  }, [active, userId, handle]);

  // Polling fallback: only while Realtime is down and an order is still in progress.
  useEffect(() => {
    if (!active || live || !watching) return undefined;
    let controller = new AbortController();
    const tick = () => {
      if (document.hidden) return;
      controller.abort();
      controller = new AbortController();
      poll(controller.signal);
    };
    const timer = setInterval(tick, STATUS_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); controller.abort(); };
  }, [active, live, watching, poll]);

  // Orders placed in this tab start being watched straight away.
  const track = useCallback((order) => {
    if (!order?.id) return;
    tracker.current.track(order);
    setWatching(tracker.current.hasOpenOrders());
  }, []);

  return { live, watching, track };
}
