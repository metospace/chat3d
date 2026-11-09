import {defineConfig,mergeConfig} from 'vite';
import {resolve} from 'node:path';
import workspaceConfig from './vite.config.ts';

export default defineConfig(env=>mergeConfig(workspaceConfig(env),{
  base: '/team/',
  build: {
    outDir: 'dist-team-web',
    emptyOutDir: true,
    rollupOptions: {input: resolve('team-web.html')},
  },
}));
