import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  platform: 'node',
  bundle: true,
  external: [
    // 不打包这些，它们在 monorepo 中
    '../../../src/agent-v2',
    '../../../src/providers',
  ],
  tsconfig: './tsconfig.json',
});
