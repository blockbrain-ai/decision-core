import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

export function findBundledConfigDir(startDir: string): string {
  let current = resolve(startDir);

  while (true) {
    const rootConfig = join(current, 'config');
    if (existsSync(rootConfig)) {
      return rootConfig;
    }

    const distConfig = join(current, 'dist', 'config');
    if (existsSync(distConfig)) {
      return distConfig;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate bundled config directory from ${startDir}`);
    }
    current = parent;
  }
}

export function resolveBundledConfigPath(startDir: string, ...parts: string[]): string {
  return join(findBundledConfigDir(startDir), ...parts);
}
