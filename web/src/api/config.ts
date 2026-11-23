import type { Config } from '../types';

export const DEFAULT_CONFIG: Config = {
  api: 'https://cloudinary-api-k1t3.onrender.com',
  key: '',
  cdn: 'https://cloudinary-delivery.k4leido5.workers.dev',
};

export function readConfig(): Config {
  try {
    return {
      api: localStorage.getItem('img.api') ?? DEFAULT_CONFIG.api,
      key: localStorage.getItem('img.key') ?? DEFAULT_CONFIG.key,
      cdn: localStorage.getItem('img.cdn') ?? DEFAULT_CONFIG.cdn,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeConfig(config: Config): void {
  try {
    localStorage.setItem('img.api', config.api);
    localStorage.setItem('img.key', config.key);
    localStorage.setItem('img.cdn', config.cdn);
  } catch {
    // storage can be unavailable in private mode; the session still works
  }
}
