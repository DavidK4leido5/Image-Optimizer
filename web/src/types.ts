export type AssetStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type Variant = { transform: string; url: string; bytes: number };

export type Asset = {
  id: string;
  publicId: string;
  status: AssetStatus;
  error: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  variants: Variant[];
};

export type Limits = {
  database: { bytes: number; limit: number };
  storage: { bytes: number; objects: number; limit: number };
  queue: { depth: number; limit: number };
  assets: number;
  measuredAt: string;
};

export type Point = [timestampSeconds: number, value: number];

export type ServiceName = 'cloudinary-api' | 'cloudinary-processor';

export type RangeHours = 1 | 6 | 24;

export type MetricKey = 'cpu' | 'rss' | 'heap' | 'rps' | 'p95';

export type Config = { api: string; key: string; cdn: string };

export type UploadStage = 'queued' | 'creating' | 'uploading' | 'processing' | 'done' | 'error';

export type UploadItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  stage: UploadStage;
  progress: number;
  publicId?: string;
  error?: string;
  retryAfter?: number;
};
