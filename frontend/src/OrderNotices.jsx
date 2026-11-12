// US4 in-app notifications: a small stack of order updates in the corner of every student page.
// A Ready notice stays until the student opens or dismisses it; Preparing is informational.
export default function OrderNotices({ notices, onOpen, onDismiss }) {
  return (
    // The live region is always on the page, so screen readers announce notices as they arrive.
    <div className="order-notices" aria-live="polite" aria-relevant="additions">
      <>
        {notices.map((notice) => <article key={notice.id} className={`order-notice order-notice-${notice.status.toLowerCase()}`}>
          <p className="order-notice-label">{notice.status === 'Ready' ? 'Ready for pickup' : 'Order update'}</p>
          <h2 className="order-notice-title">{notice.title}</h2>
          <p className="order-notice-body">{notice.body}</p>
          <div className="order-notice-actions">
            <button className="order-notice-open" onClick={() => onOpen(notice)}>View order</button>
            <button className="order-notice-dismiss" aria-label={`Dismiss update for order ${notice.number}`} onClick={() => onDismiss(notice)}>Dismiss</button>
          </div>
        </article>)}
      </>
    </div>
  );
}
