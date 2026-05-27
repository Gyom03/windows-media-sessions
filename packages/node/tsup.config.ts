import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  shims: false,
  splitting: false,
  treeshake: true,
  minify: false,
  // We deliberately bundle our own source but leave node built-ins as
  // externals — there are no runtime npm dependencies.
  external: [],
});
