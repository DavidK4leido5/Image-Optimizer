import type { Asset } from '../types';
import { formatBytes, relativeTime } from '../format';

type Props = {
  asset: Asset;
  imageBase: string;
  onOpen: (asset: Asset) => void;
};

export function AssetCard({ asset, imageBase, onOpen }: Props) {
  const preview = asset.variants[0];
  const dimensions = asset.width && asset.height ? asset.width + ' × ' + asset.height : '—';
  const label =
    'Open ' + asset.publicId + ', ' + asset.status + ', ' + dimensions + ', ' + formatBytes(asset.bytes);

  return (
    <article className="asset-card">
      <div className="asset-card__media">
        {preview ? (
          <img
            src={imageBase + preview.url}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => {
              const image = event.currentTarget;
              if (image.dataset.retried) return;
              image.dataset.retried = '1';
              image.src = image.src.split('?')[0] + '?r=' + Date.now();
            }}
          />
        ) : (
          <div className="asset-card__placeholder">{asset.status}</div>
        )}
        <span className={'pill pill--' + asset.status}>{asset.status}</span>
      </div>

      <div className="asset-card__meta">
        <div className="asset-card__row">
          <span className="asset-card__id" title={asset.publicId}>
            {asset.publicId}
          </span>
          <span className="asset-card__variants">{asset.variants.length} variants</span>
        </div>

        <div className="asset-card__row asset-card__row--quiet">
          <span>{dimensions}</span>
          <span>{formatBytes(asset.bytes)}</span>
          <span>{relativeTime(asset.createdAt)}</span>
        </div>

        {asset.status === 'failed' && asset.error && (
          <p className="asset-card__error" title={asset.error}>
            {asset.error}
          </p>
        )}
      </div>

      <button type="button" className="asset-card__open" onClick={() => onOpen(asset)} aria-label={label} />
    </article>
  );
}
