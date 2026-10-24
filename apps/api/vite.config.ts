import swc from 'unplugin-swc';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  // swc keeps emitDecoratorMetadata, which Nest DI needs
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['test/**/*.spec.ts'], setupFiles: ['test/setup.ts'] },
});
