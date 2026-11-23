import type { UploadItem } from '../types';
import { formatBytes } from '../format';

type Props = {
  items: UploadItem[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearDone: () => void;
};

const STAGES = ['create', 'upload', 'process'] as const;

function stageState(item: UploadItem, stage: (typeof STAGES)[number]): 'done' | 'active' | 'pending' {
  const order = { queued: 0, creating: 1, uploading: 2, processing: 3, done: 4, error: 4 } as const;
  const current = order[item.stage];
  const index = STAGES.indexOf(stage) + 1;
  if (item.stage === 'error') return current > index ? 'done' : 'pending';
  if (current > index) return 'done';
  if (current === index) return 'active';
  return 'pending';
}

function statusText(item: UploadItem): string {
  if (item.stage === 'queued') return 'Waiting';
  if (item.stage === 'creating') return 'Creating asset';
  if (item.stage === 'uploading') return 'Uploading ' + Math.round(item.progress * 100) + '%';
  if (item.stage === 'processing') return 'Processing variants';
  if (item.stage === 'done') return 'Done';
  return 'Failed';
}

export function UploadQueue({ items, onRetry, onDismiss, onClearDone }: Props) {
  if (items.length === 0) return null;
  const done = items.filter((item) => item.stage === 'done').length;

  return (
    <section className="panel upload-queue" aria-label="Upload queue">
      <div className="panel__head">
        <h2>Uploads</h2>
        <div className="panel__actions">
          <span className="muted">{done} of {items.length} done</span>
          {done > 0 && (
            <button type="button" className="button button--ghost button--small" onClick={onClearDone}>
              Clear done
            </button>
          )}
        </div>
      </div>

      <ul className="upload-queue__list">
        {items.map((item) => {
          const active = item.stage === 'creating' || item.stage === 'uploading' || item.stage === 'processing';
          return (
            <li key={item.id} className={'upload-item upload-item--' + item.stage}>
              <div className="upload-item__main">
                <div className="upload-item__top">
                  <span className="upload-item__name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="upload-item__size">{formatBytes(item.size)}</span>
                </div>

                <div className="stages" role="img" aria-label={statusText(item)}>
                  {STAGES.map((stage) => {
                    const state = stageState(item, stage);
                    const fill =
                      stage === 'upload' && state === 'active' ? Math.round(item.progress * 100) : undefined;
                    return (
                      <span key={stage} className={'stage stage--' + state}>
                        <span className="stage__track">
                          {fill !== undefined && <span className="stage__fill" style={{ width: fill + '%' }} />}
                        </span>
                        <span className="stage__label">{stage}</span>
                      </span>
                    );
                  })}
                </div>

                <div className="upload-item__status">
                  <span>{statusText(item)}</span>
                  {item.stage === 'error' && <span className="upload-item__error">{item.error}</span>}
                  {item.retryAfter !== undefined && (
                    <span className="muted">Server asked to retry after {item.retryAfter}s.</span>
                  )}
                </div>
              </div>

              <div className="upload-item__actions">
                {item.stage === 'error' && (
                  <button type="button" className="button button--ghost button--small" onClick={() => onRetry(item.id)}>
                    Retry
                  </button>
                )}
                {!active && (
                  <button type="button" className="button button--ghost button--small" onClick={() => onDismiss(item.id)}>
                    Dismiss
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
