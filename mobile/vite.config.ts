import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const dependencies = (name: string) => path.join(here, 'node_modules', name);

export default defineConfig({
  plugins: [react(), {
    name: 'shared-customer-assets',
    generateBundle() {
      for (const folder of ['brand', 'devices', 'atmospheres', 'textures']) {
        for (const file of readdirSync(path.join(here, '../public', folder))) {
          this.emitFile({ type: 'asset', fileName: `${folder}/${file}`, source: readFileSync(path.join(here, '../public', folder, file)) });
        }
      }
    },
  }],
  resolve: { alias: {
    'next/link': path.join(here, 'src/adapters/link.tsx'),
    'next/image': path.join(here, 'src/adapters/image.tsx'),
    'next/navigation': path.join(here, 'src/adapters/navigation.tsx'),
    'react': dependencies('react'), 'react-dom': dependencies('react-dom'), 'lucide-react': dependencies('lucide-react'),
    'tailwindcss': dependencies('tailwindcss'),
  }, dedupe: ['react', 'react-dom'] },
  css: { postcss: { plugins: [tailwind()] } },
  build: { target: 'es2022' },
});
