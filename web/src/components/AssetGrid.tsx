import type { Asset } from '../types';
import { AssetCard } from './AssetCard';

type Props = {
  assets: Asset[];
  total: number;
  hasFilters: boolean;
  hasMore: boolean;
  imageBase: string;
  onOpen: (asset: Asset) => void;
  onShowMore: () => void;
  onClearFilters: () => void;
};

export function AssetGrid({
  assets,
  total,
  hasFilters,
  hasMore,
  imageBase,
  onOpen,
  onShowMore,
  onClearFilters,
}: Props) {
  if (total === 0) {
    return (
      <div className="empty">
        <h3>No images yet</h3>
        <p>Upload one above. The processor writes three WebP variants and the CDN serves them.</p>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="empty">
        <h3>No images match</h3>
        <p>Try a different id or clear the status filter.</p>
        <button type="button" className="button button--ghost" onClick={onClearFilters}>
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="asset-grid">
        {assets.map((asset) => (
          <AssetCard key={asset.id} asset={asset} imageBase={imageBase} onOpen={onOpen} />
        ))}
      </div>

      {hasMore && (
        <div className="asset-grid__more">
          <button type="button" className="button button--ghost" onClick={onShowMore}>
            Show more
          </button>
        </div>
      )}

      {hasFilters && assets.length > 0 && (
        <p className="muted asset-grid__note">
          Filtered view. <button type="button" className="link" onClick={onClearFilters}>Clear filters</button>
        </p>
      )}
    </>
  );
}
