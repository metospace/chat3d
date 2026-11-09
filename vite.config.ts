import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import {readFileSync} from "node:fs";
// @ts-expect-error JavaScript server plugin has no declaration file
import {modelProxyPlugin} from "./server/node-adapter.mjs";
// @ts-expect-error JavaScript server plugin has no declaration file
import {appVersionPlugin} from "./server/app-version.mjs";
// @ts-expect-error JavaScript release metadata has no declaration file
import {versionBody} from "./shared/app-version.mjs";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({mode}) => ({
  define: {__APP_BUILD_COMMIT__: JSON.stringify(process.env.GITHUB_SHA ?? "local")},
  cacheDir: 'node_modules/.vite-app',
  optimizeDeps: {include:['@earendil-works/pi-agent-core','@earendil-works/pi-ai','@earendil-works/pi-ai/api/openai-completions']},
  plugins: [react(), tailwindcss(), {
    name: 'scenivo-isolated-test-cache',
    config(config) {
      if(config.server?.middlewareMode)return {cacheDir:`node_modules/.vite-ssr/${process.pid}`,optimizeDeps:{noDiscovery:true,include:[]}};
    },
  }, {
    name: 'scenivo-web-entry',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url=new URL(request.url??'/', 'http://localhost');
        if(url.pathname==='/team'){response.writeHead(302,{Location:'/team/'+url.search});response.end();return;}
        if(url.pathname.startsWith('/team/')&&!url.pathname.split('/').pop()?.includes('.'))request.url='/team-web.html'+url.search;
        next();
      });
    },
  }, modelProxyPlugin(loadEnv(mode, process.cwd(), "CHAT3D_").CHAT3D_ALLOWED_UPSTREAMS), appVersionPlugin(), {
    name: "chat3d-emit-app-version",
    apply: "build",
    generateBundle() {
      const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
      const body = versionBody(version, {notes: process.env.CHAT3D_UPDATE_NOTES ?? "", pubDate: process.env.CHAT3D_UPDATE_PUB_DATE ?? ""});
      if (!body) this.error("package.json version is not a supported release version");
      this.emitFile({type: "asset", fileName: "version.json", source: JSON.stringify(body)});
    },
  }],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    allowedHosts: ["terminal.local"],
    strictPort: true,
    host: host || false,
    proxy: loadEnv(mode, process.cwd(), 'CHAT3D_').CHAT3D_TEAM_DEV_BASE ? {
      '/api/team': {target:loadEnv(mode, process.cwd(), 'CHAT3D_').CHAT3D_TEAM_DEV_BASE,changeOrigin:true},
    } : undefined,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
