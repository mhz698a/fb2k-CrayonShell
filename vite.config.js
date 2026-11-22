import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    base: './',
    publicDir: 'public',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        cssCodeSplit: false,
        lib: {
            entry: resolve(process.cwd(), 'src/main.jsx'),
            name: 'CrayonShell',
            formats: ['iife'],
            fileName: () => 'crayonshell',
            cssFileName: 'crayonshell'
        }
    }
});
