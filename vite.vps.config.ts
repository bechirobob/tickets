import vinext from 'vinext';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: {
    'cloudflare:workers': fileURLToPath(new URL('./runtime/vps/cloudflare-workers.mjs', import.meta.url)),
    'cloudflare:sockets': fileURLToPath(new URL('./runtime/vps/cloudflare-sockets.mjs', import.meta.url)),
  } },
  plugins: [vinext()],
});
