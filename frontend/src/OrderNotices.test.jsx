// Component tests for the US4 in-app order notices.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OrderNotices from './OrderNotices.jsx';
import { noticeFor } from './order-notifications.js';

const ID = '0a1b2c3d-0000-4000-8000-000000000001';

describe('OrderNotices', () => {
  it('shows each notice with a way to open the order or dismiss it', async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    const ready = noticeFor(ID, 'Ready');
    render(<OrderNotices notices={[ready]} onOpen={onOpen} onDismiss={onDismiss} />);

    expect(screen.getByRole('heading', { name: 'Order #0A1B2C3D is ready for pickup' })).toBeInTheDocument();
    expect(screen.getByText('Ready for pickup')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View order' }));
    expect(onOpen).toHaveBeenCalledWith(ready);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss update for order 0A1B2C3D' }));
    expect(onDismiss).toHaveBeenCalledWith(ready);
  });

  it('keeps an empty live region on the page so new notices are announced', () => {
    const { container } = render(<OrderNotices notices={[]} onOpen={vi.fn()} onDismiss={vi.fn()} />);

    expect(container.querySelector('[aria-live="polite"]')).toBeEmptyDOMElement();
  });
});
