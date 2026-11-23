import { useCallback, useState } from 'react';
import type { Config } from '../types';
import { readConfig, writeConfig } from '../api/config';

export function useConfig() {
  const [config, setConfig] = useState<Config>(readConfig);

  const update = useCallback((patch: Partial<Config>) => {
    setConfig((current) => {
      const next = { ...current, ...patch };
      writeConfig(next);
      return next;
    });
  }, []);

  return { config, update };
}
