import type { RefObject } from 'react';
import type { AssetStatus } from '../types';

export type StatusFilter = AssetStatus | 'all';
export type SortOrder = 'newest' | 'oldest' | 'largest';

type Props = {
  search: string;
  onSearch: (value: string) => void;
  status: StatusFilter;
  onStatus: (value: StatusFilter) => void;
  sort: SortOrder;
  onSort: (value: SortOrder) => void;
  total: number;
  shown: number;
  capped: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
};

export function AssetToolbar({
  search,
  onSearch,
  status,
  onStatus,
  sort,
  onSort,
  total,
  shown,
  capped,
  searchRef,
}: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar__search">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search by public id"
          aria-label="Search assets by public id"
        />
        <kbd aria-hidden="true">/</kbd>
      </div>

      <label className="toolbar__select">
        <span>Status</span>
        <select value={status} onChange={(event) => onStatus(event.target.value as StatusFilter)}>
          <option value="all">All</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </label>

      <label className="toolbar__select">
        <span>Sort</span>
        <select value={sort} onChange={(event) => onSort(event.target.value as SortOrder)}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="largest">Largest</option>
        </select>
      </label>

      <span className="toolbar__count" aria-live="polite">
        {shown} of {total}
        {capped && ' · API returns the latest 100'}
      </span>
    </div>
  );
}
