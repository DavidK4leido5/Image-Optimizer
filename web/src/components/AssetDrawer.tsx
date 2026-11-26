import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { formatBytes, formatDate } from '../format';
import type { Asset, Variant } from '../types';
import { ResponsivePresets } from './ResponsivePresets';

export type AssetDrawerProps = {
  asset: Asset | null;
  imageBase: string;
  onClose: () => void;
  onDelete: (publicId: string) => Promise<void>;
  onCopy: (text: string, message?: string) => void;
};

// Variants carry no width, so read it from the transform ("...w_1600..."). Unknown
// widths compare equal, which leaves the first variant as the preview.
function widthOf(transform: string): number {
  const match = /w_(\d+)/.exec(transform);
  return match ? Number(match[1]) : 0;
}

function largest(variants: Variant[]): Variant | null {
  return variants.reduce<Variant | null>(
    (best, variant) => (!best || widthOf(variant.transform) > widthOf(best.transform) ? variant : best),
    null,
  );
}

function largestFit(variants: Variant[]): Variant | null {
  return largest(variants.filter((variant) => variant.transform.includes('c_fit')));
}

function previewVariant(variants: Variant[]): Variant | null {
  // The full frame is the honest preview. A crop is the fallback, not the default.
  return largestFit(variants) ?? largest(variants);
}

export function AssetDrawer(props: AssetDrawerProps): JSX.Element {
  const { asset, imageBase, onClose, onDelete, onCopy } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const preview = asset ? previewVariant(asset.variants) : null;
  const fullFrame = asset ? largestFit(asset.variants) : null;
  const cropped = preview ? preview.transform.includes('c_fill') : false;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (asset && !dialog.open) {
      const focused = document.activeElement;
      restoreRef.current = focused instanceof HTMLElement ? focused : null;
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!asset && dialog.open) {
      dialog.close();
    }
  }, [asset]);

  useEffect(() => {
    setConfirming(false);
    setDeleting(false);
  }, [asset?.publicId]);

  function handleClose() {
    onClose();
    const previous = restoreRef.current;
    restoreRef.current = null;
    if (previous?.isConnected) previous.focus();
  }

  async function remove() {
    if (!asset) return;
    setDeleting(true);
    try {
      await onDelete(asset.publicId);
    } catch {
      // the parent surfaces the failure; keep the drawer open so it can be retried
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="drawer"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={handleClose}
      onPointerDown={(event) => {
        backdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const backdrop = backdropRef.current && event.target === event.currentTarget;
        backdropRef.current = false;
        if (backdrop) dialogRef.current?.close();
      }}
    >
      <div className="drawer__panel">
        {asset && (
          <>
            <header className="drawer__header">
              <div className="drawer__heading">
                <h2 className="drawer__title" id={titleId}>
                  <code>{asset.publicId}</code>
                </h2>
                <span className={'drawer__status drawer__status--' + asset.status}>{asset.status}</span>
              </div>
              <div className="drawer__header-actions">
                <button
                  type="button"
                  className="drawer__copy"
                  aria-label="Copy public id"
                  onClick={() => onCopy(asset.publicId, 'public id copied')}
                >
                  Copy
                </button>
                <button
                  ref={closeRef}
                  type="button"
                  className="drawer__close"
                  aria-label="Close"
                  onClick={() => dialogRef.current?.close()}
                >
                  ×
                </button>
              </div>
            </header>

            <p className="drawer__description" id={descriptionId}>
              Original file, dimensions and every generated variant. The preview uses the full frame when one exists.
            </p>

            <div className="drawer__preview">
              {preview ? (
                <img
                  key={preview.url}
                  src={imageBase + preview.url}
                  alt={asset.publicId}
                  onError={(event) => {
                    const image = event.currentTarget;
                    if (image.dataset.retried) return;
                    image.dataset.retried = '1';
                    image.src = image.src.split('?')[0] + '?r=' + Date.now();
                  }}
                />
              ) : (
                <p className="drawer__empty">no variants yet</p>
              )}
            </div>

            {cropped && (
              <p className="drawer__note">
                This asset has no full-frame variant yet, so the preview is cropped.
                {fullFrame && (
                  <>
                    {' '}
                    <a href={imageBase + fullFrame.url} target="_blank" rel="noreferrer">
                      See a full frame
                    </a>
                    .
                  </>
                )}
              </p>
            )}

            <dl className="drawer__meta">
              <dt>dimensions</dt>
              <dd>{asset.width !== null && asset.height !== null ? asset.width + 'x' + asset.height : '—'}</dd>
              <dt>original size</dt>
              <dd>{formatBytes(asset.bytes)}</dd>
              <dt>created</dt>
              <dd>{formatDate(asset.createdAt)}</dd>
              <dt>variants</dt>
              <dd>{asset.variants.length}</dd>
            </dl>

            <ResponsivePresets publicId={asset.publicId} imageBase={imageBase} onCopy={onCopy} />

            {asset.status === 'failed' && (
              <p className="drawer__warning">{asset.error ?? 'processing failed'}</p>
            )}

            <ul className="drawer__variants">
              {asset.variants.map((variant) => {
                const url = imageBase + variant.url;
                return (
                  <li className="drawer__variant" key={variant.transform + variant.url}>
                    <code>{variant.transform}</code>
                    <span>{formatBytes(variant.bytes)}</span>
                    <a href={url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                    <button
                      type="button"
                      className="drawer__copy"
                      aria-label={'Copy ' + variant.transform + ' url'}
                      onClick={() => onCopy(url, variant.transform + ' url copied')}
                    >
                      Copy
                    </button>
                  </li>
                );
              })}
            </ul>

            <footer className="drawer__actions">
              {confirming ? (
                <>
                  <button
                    type="button"
                    className="drawer__danger"
                    disabled={deleting}
                    onClick={remove}
                  >
                    Confirm delete
                  </button>
                  <button type="button" disabled={deleting} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="drawer__danger"
                  disabled={deleting}
                  onClick={() => setConfirming(true)}
                >
                  Delete
                </button>
              )}
              {deleting && <span className="drawer__hint">deleting…</span>}
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
