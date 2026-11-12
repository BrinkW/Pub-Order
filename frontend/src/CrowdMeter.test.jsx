import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { CrowdMeter, CrowdMeterControls } from './CrowdMeter.jsx';
import { loadCrowd, setCrowdLevel } from './crowd-api.js';

vi.mock('./crowd-api.js', () => ({
  CROWD_LEVELS: ['low', 'moderate', 'busy'],
  loadCrowd: vi.fn(),
  setCrowdLevel: vi.fn(),
}));

beforeEach(() => {
  loadCrowd.mockReset();
  setCrowdLevel.mockReset();
});

it('shows students the latest staff-reported level', async () => {
  loadCrowd.mockResolvedValue({ level: 'moderate', updatedAt: '2026-11-11T14:00:00Z' });

  render(<CrowdMeter />);

  expect(await screen.findByRole('heading', { name: 'Moderate' })).toBeInTheDocument();
  expect(screen.getByText(/Staff update at/)).toBeInTheDocument();
});

it('lets staff choose the level that matches what they see', async () => {
  loadCrowd.mockResolvedValue({ level: 'low', updatedAt: '2026-11-11T13:00:00Z' });
  setCrowdLevel.mockResolvedValue({ crowd: { level: 'busy', updatedAt: '2026-11-11T14:00:00Z' } });
  const user = userEvent.setup();

  render(<CrowdMeterControls />);
  await user.click(await screen.findByRole('button', { name: 'Busy' }));

  expect(setCrowdLevel).toHaveBeenCalledWith('busy');
  expect(await screen.findByRole('button', { name: 'Busy' })).toHaveAttribute('aria-pressed', 'true');
});
