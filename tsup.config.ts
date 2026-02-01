import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/demo-1.ts', 'src/server.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    // esbuild 内联文本内容
    esbuildOptions(options) {
        options.loader = {
            ...options.loader,
            '.txt': 'text',
        };
    },
});
