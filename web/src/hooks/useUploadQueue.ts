import { useCallback, useRef, useState } from 'react';
import type { Asset, UploadItem } from '../types';
import { ApiError, completeAsset, createAsset, uploadFile } from '../api/client';

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function describe(error: unknown): { message: string; retryAfter?: number } {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const wait = error.retryAfter;
      return {
        message: wait
          ? 'Queue is full. Try again in ' + wait + 's.'
          : 'Queue is full. Try again shortly.',
        retryAfter: wait,
      };
    }
    if (error.status === 409) return { message: 'Upload not found in storage. Retry the file.' };
    if (error.status === 413) return { message: 'File is larger than the 20 MB limit.' };
    if (error.status === 401) return { message: 'Unauthorized. Check the API key.' };
    if (error.status === 0) return { message: 'Network error. Check your connection and retry.' };
    return { message: error.message };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export function useUploadQueue() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const runningRef = useRef(false);
  const pumpRef = useRef<() => Promise<void>>(async () => {});

  const commit = useCallback((next: UploadItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<UploadItem>) => {
      commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
    },
    [commit],
  );

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    const next = itemsRef.current.find((item) => item.stage === 'queued');
    if (!next) return;

    runningRef.current = true;
    const id = next.id;

    try {
      patch(id, { stage: 'creating', progress: 0, error: undefined, retryAfter: undefined });
      const created = await createAsset({
        fileName: next.file.name,
        contentType: next.file.type,
        bytes: next.file.size,
      });

      patch(id, { stage: 'uploading', publicId: created.publicId });
      await uploadFile(created.upload, next.file, (fraction) => patch(id, { progress: fraction }));

      patch(id, { stage: 'processing', progress: 1 });
      await completeAsset(created.publicId);
    } catch (error) {
      const described = describe(error);
      patch(id, { stage: 'error', error: described.message, retryAfter: described.retryAfter });
    } finally {
      runningRef.current = false;
      void pumpRef.current();
    }
  }, [patch]);

  pumpRef.current = pump;

  const add = useCallback(
    (files: File[]) => {
      const added: UploadItem[] = files.map((file) => {
        const base: UploadItem = {
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          stage: 'queued',
          progress: 0,
        };

        if (!ACCEPTED.has(file.type)) {
          return { ...base, stage: 'error', error: 'Unsupported type. Use JPEG, PNG, WebP, or GIF.' };
        }
        if (file.size > MAX_BYTES) {
          return { ...base, stage: 'error', error: 'File is larger than the 20 MB limit.' };
        }
        return base;
      });

      commit([...itemsRef.current, ...added]);
      void pumpRef.current();
    },
    [commit],
  );

  const retry = useCallback(
    (id: string) => {
      patch(id, { stage: 'queued', progress: 0, error: undefined, retryAfter: undefined });
      void pumpRef.current();
    },
    [patch],
  );

  const dismiss = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item) return;
      if (item.stage === 'creating' || item.stage === 'uploading' || item.stage === 'processing') return;
      commit(itemsRef.current.filter((candidate) => candidate.id !== id));
    },
    [commit],
  );

  const clearDone = useCallback(() => {
    commit(itemsRef.current.filter((item) => item.stage !== 'done'));
  }, [commit]);

  const syncAssets = useCallback(
    (assets: Asset[]) => {
      const byId = new Map(assets.map((asset) => [asset.publicId, asset]));
      let changed = false;

      const next = itemsRef.current.map((item) => {
        if (!item.publicId || item.stage !== 'processing') return item;
        const asset = byId.get(item.publicId);
        if (!asset) return item;
        if (asset.status === 'ready') {
          changed = true;
          return { ...item, stage: 'done' as const, progress: 1 };
        }
        if (asset.status === 'failed') {
          changed = true;
          return { ...item, stage: 'error' as const, error: asset.error ?? 'Processing failed.' };
        }
        return item;
      });

      if (changed) commit(next);
    },
    [commit],
  );

  return { items, add, retry, dismiss, clearDone, syncAssets };
}
