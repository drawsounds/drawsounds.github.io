import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
export default defineConfig(() => ({
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
    server: {
        host: '0.0.0.0',
        port: 3000,
        allowedHosts: true as const,
        hmr: process.env['DISABLE_HMR'] !== 'true',
        watch: process.env['DISABLE_HMR'] === 'true' ? null : {},
    },
}));
