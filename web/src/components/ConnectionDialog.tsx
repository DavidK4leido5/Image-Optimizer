import { useEffect, useRef } from 'react';
import type { Config } from '../types';

type Props = {
  open: boolean;
  config: Config;
  onClose: () => void;
  onChange: (patch: Partial<Config>) => void;
};

export function ConnectionDialog({ open, config, onClose, onChange }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="connection-title">
      <div className="dialog__body">
        <header className="dialog__header">
          <div>
            <h2 id="connection-title">Connection</h2>
            <p className="muted">Changes apply immediately and are stored in this browser.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close connection settings">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="field">
          <label htmlFor="config-api">API base URL</label>
          <input
            id="config-api"
            type="url"
            value={config.api}
            spellCheck={false}
            onChange={(event) => onChange({ api: event.target.value })}
            placeholder="https://your-api.onrender.com"
          />
          <p className="field__hint">The .NET service. It issues upload URLs and proxies telemetry.</p>
        </div>

        <div className="field">
          <label htmlFor="config-key">API key</label>
          <input
            id="config-key"
            type="password"
            value={config.key}
            spellCheck={false}
            onChange={(event) => onChange({ key: event.target.value })}
            placeholder="X-Api-Key"
          />
          <p className="field__hint">Sent as the X-Api-Key header. Stored only in this browser.</p>
        </div>

        <div className="field">
          <label htmlFor="config-cdn">CDN base URL</label>
          <input
            id="config-cdn"
            type="url"
            value={config.cdn}
            spellCheck={false}
            onChange={(event) => onChange({ cdn: event.target.value })}
            placeholder="https://your-worker.workers.dev"
          />
          <p className="field__hint">Image previews and links are built from this URL.</p>
        </div>

        <footer className="dialog__footer">
          <button type="button" className="button button--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </dialog>
  );
}
