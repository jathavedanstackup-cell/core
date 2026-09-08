import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // The API runs separately in development. Proxying keeps the browser on a
        // single origin, so session cookies behave exactly as they will in
        // production behind one domain.
        proxy: {
            '/api': { target: 'http://localhost:4000', changeOrigin: true },
            '/health': { target: 'http://localhost:4000', changeOrigin: true },
            '/readiness': { target: 'http://localhost:4000', changeOrigin: true },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom', 'react-router-dom'],
                },
            },
        },
    },
});
