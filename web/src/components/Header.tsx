import type { Config } from '../types';

export type HealthState = {
  status: 'checking' | 'up' | 'down';
  latency: number | null;
  checkedAt: number | null;
};

type Props = {
  health: HealthState;
  online: boolean;
  theme: 'light' | 'dark';
  config: Config;
  onToggleTheme: () => void;
  onRecheck: () => void;
  onOpenConnection: () => void;
};

function clock(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function Header({
  health,
  online,
  theme,
  config,
  onToggleTheme,
  onRecheck,
  onOpenConnection,
}: Props) {
  const label =
    health.status === 'up' ? 'API up' : health.status === 'down' ? 'API down' : 'Checking API';
  const detail =
    health.status === 'up' && health.latency !== null
      ? health.latency + ' ms · ' + clock(health.checkedAt)
      : health.status === 'down'
        ? 'checked ' + (clock(health.checkedAt) || 'just now')
        : 'waiting for the first check';

  let host = config.api;
  try {
    host = new URL(config.api).host;
  } catch {
    // keep the raw value
  }

  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__mark" aria-hidden="true" />
        <div>
          <h1 className="header__title">image console</h1>
          <p className="header__subtitle">Upload, inspect, and watch the two services.</p>
        </div>
      </div>

      <div className="header__actions">
        {!online && (
          <span className="badge badge--danger" role="status">
            Offline
          </span>
        )}

        <button
          type="button"
          className="health"
          data-status={health.status}
          onClick={onRecheck}
          title="Check the API health now"
        >
          <span className="health__dot" aria-hidden="true" />
          <span className="health__text">
            <strong>{label}</strong>
            <span>{detail}</span>
          </span>
        </button>

        <button
          type="button"
          className="connection-chip"
          onClick={onOpenConnection}
          title="Edit connection settings"
        >
          <span className={config.key ? 'connection-chip__dot' : 'connection-chip__dot is-empty'} aria-hidden="true" />
          <span>{host || 'Set connection'}</span>
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" fill="currentColor" />
              <path
                d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8a8.5 8.5 0 1 0 11.4 11.4Z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
