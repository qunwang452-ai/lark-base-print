import { defineConfig } from 'vite';

// GitHub Pages 部署在 https://<user>.github.io/<repo>/ 子路径下，
// 所以打包时要带 base 前缀；本地 dev 用根路径。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/lark-base-print/' : '/',
  build: { outDir: 'dist', emptyOutDir: true },
}));
