import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WebView 通过 file:// 加载 index.html 时，浏览器会拒绝执行 type="module" 脚本。
// 构建产物本身已是 IIFE 单文件，这里把它改写为普通 <script defer>：
//   - 去掉 type="module"：避免 file:// 下被 CORS 拦截；
//   - 必须保留 defer：脚本在 <head> 中，若同步执行，此时 #root 尚未解析，会导致白屏。
function classicScriptTag() {
  return {
    name: 'classic-script-tag',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
        .replace(/<script type="module" src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
        .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
        // file:// 下带 crossorigin 的样式表会被 CORS 拦截，去掉
        .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, '<link rel="stylesheet" href="$1">')
    }
  }
}

export default defineConfig({
  plugins: [react(), classicScriptTag()],
  base: './',
  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    modulePreload: false,
    target: 'es2015',
    minify: 'terser',
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001'
    }
  }
})
