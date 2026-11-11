import { useEffect, useState } from 'react';
import { CROWD_LEVELS, loadCrowd, setCrowdLevel } from './crowd-api.js';
import './crowd.css';

const LABELS = { not_reported: 'Not reported', low: 'Low', moderate: 'Moderate', busy: 'Busy' };

function timeLabel(updatedAt) {
  if (!updatedAt) return 'Waiting for a staff update';
  const value = new Date(updatedAt);
  if (Number.isNaN(value.getTime())) return 'Updated by staff';
  return `Staff update at ${value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function CrowdMeter() {
  const [crowd, setCrowd] = useState({ level: 'not_reported', updatedAt: null });
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        setCrowd(await loadCrowd(controller.signal));
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      }
    }
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  return <section className={`crowd-meter crowd-meter-${crowd.level}`} aria-labelledby="crowd-meter-title">
    <div>
      <p className="crowd-meter-kicker">Crowd meter</p>
      <h2 id="crowd-meter-title">{LABELS[crowd.level]}</h2>
      <p>{error || timeLabel(crowd.updatedAt)}</p>
    </div>
    <span className="crowd-meter-dots" aria-hidden="true"><i /><i /><i /></span>
  </section>;
}

export function CrowdMeterControls() {
  const [crowd, setCrowd] = useState({ level: 'not_reported', updatedAt: null });
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadCrowd(controller.signal).then((result) => {
      if (!controller.signal.aborted) { setCrowd(result); setState('ready'); }
    }).catch((failure) => {
      if (!controller.signal.aborted) { setError(failure.message); setState('error'); }
    });
    return () => controller.abort();
  }, []);

  async function choose(level) {
    setState('saving'); setError('');
    try {
      const result = await setCrowdLevel(level);
      if (result.signInRequired) { setError('Sign in with the kitchen account to update the crowd level.'); setState('error'); return; }
      if (result.forbidden) { setError('This account cannot update the crowd level.'); setState('error'); return; }
      setCrowd(result.crowd); setState('ready');
    } catch (failure) {
      setError(failure.message); setState('error');
    }
  }

  return <section className="order-group crowd-controls" aria-labelledby="kitchen-crowd-meter">
    <h2 id="kitchen-crowd-meter">Crowd meter</h2>
    <p>Choose the level that best matches what staff can currently see.</p>
    <div role="group" aria-label="Current crowd level">
      {CROWD_LEVELS.map((level) => <button
        key={level}
        type="button"
        className="menu-add"
        aria-pressed={crowd.level === level}
        disabled={state === 'saving'}
        onClick={() => choose(level)}
      >{LABELS[level]}</button>)}
    </div>
    <span className="crowd-controls-time">{timeLabel(crowd.updatedAt)}</span>
    {error ? <p className="order-refresh-error" role="alert">{error}</p> : null}
  </section>;
}
