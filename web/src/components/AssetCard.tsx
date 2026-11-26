import type { Asset } from '../types';
import { formatBytes, relativeTime } from '../format';

type Props = {
  asset: Asset;
  imageBase: string;
  onOpen: (asset: Asset) => void;
};

function widthOf(transform: string): number {
  const match = /w_(\d+)/.exec(transform);
  return match ? Number(match[1]) : 0;
}

// srcset uses commas as separators, and transform URLs contain them (w_320,c_fit,...).
const encodeUrl = (url: string) => url.replace(/,/g, '%2C');

export function AssetCard({ asset, imageBase, onOpen }: Props) {
  const ordered = [...asset.variants].sort((a, b) => widthOf(a.transform) - widthOf(b.transform));
  const smallest = ordered[0];
  const fallback = ordered.find((variant) => variant.transform.includes('c_fit')) ?? smallest;
  const src = fallback ? encodeUrl(imageBase + fallback.url) : '';
  // Only fit variants: ratio crops would change framing between breakpoints.
  const srcSet = ordered
    .filter((variant) => variant.transform.includes('c_fit') && widthOf(variant.transform) > 0)
    .map((variant) => encodeUrl(imageBase + variant.url) + ' ' + widthOf(variant.transform) + 'w')
    .join(', ');
  const dimensions = asset.width && asset.height ? asset.width + ' × ' + asset.height : '—';
  const label =
    'Open ' + asset.publicId + ', ' + asset.status + ', ' + dimensions + ', ' + formatBytes(asset.bytes);

  return (
    <article className="asset-card">
      <div className="asset-card__media">
        {smallest ? (
          <img
            src={src}
            srcSet={srcSet || undefined}
            sizes="(max-width: 520px) 45vw, 280px"
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => {
              const image = event.currentTarget;
              if (image.dataset.retried) return;
              image.dataset.retried = '1';
              image.removeAttribute('srcset');
              image.removeAttribute('sizes');
              image.src = src.split('?')[0] + '?r=' + Date.now();
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
