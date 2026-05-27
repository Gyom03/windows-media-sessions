/**
 * Resolves the absolute path to the bundled .NET backend executable.
 *
 * The backend is published into `<pkg>/bin/win-x64/windows-media-sessions-backend.exe`
 * by `scripts/build-backend.ps1`. When the package is consumed via npm the
 * `bin` folder is shipped as-is.
 *
 * We support being loaded from both ESM and CJS — `__dirname` is not
 * available under ESM, and `import.meta.url` is not available under CJS.
 * tsup emits each format separately so this file becomes valid either way.
 */

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const BACKEND_FILENAME = 'windows-media-sessions-backend.exe';

declare const __dirname: string | undefined;

function currentDir(): string {
  // CJS path
  if (typeof __dirname === 'string') return __dirname;
  // ESM path
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = (import.meta as any).url as string | undefined;
  if (typeof url === 'string') return path.dirname(fileURLToPath(url));
  throw new Error('Could not resolve current module directory');
}

export function resolveBackendPath(override?: string): string {
  if (override) return path.resolve(override);
  const envOverride = process.env.WINDOWS_MEDIA_SESSIONS_BACKEND;
  if (envOverride) return path.resolve(envOverride);

  // dist files live at <pkg>/dist/index.{js,cjs}, so the bin directory is
  // one level up.
  const here = currentDir();
  return path.join(here, '..', 'bin', 'win-x64', BACKEND_FILENAME);
}
