import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function webviewEntryPlugin() {
    return {
        name: 'crayonshell-webview-entry',
        apply: 'build',

        generateBundle() {
            const htmlPath = resolve(process.cwd(), 'webview.html');
            const html = readFileSync(htmlPath, 'utf8');

            this.emitFile({
                type: 'asset',
                fileName: 'index.html',
                source: html
            });
        }
    };
}

export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        webviewEntryPlugin()
    ],
    // React's library build keeps process.env.NODE_ENV by default.
    // WebView2 is a browser runtime and does not provide the Node.js process global.
    define: command === 'build'
        ? {
            'process.env.NODE_ENV': JSON.stringify('production')
        }
        : {},
    base: './',
    publicDir: false,
    build: {
        outDir: resolve(process.cwd(), '../fb2k-CrayonShell-Build'),
        emptyOutDir: true,
        cssCodeSplit: false,
        lib: {
            entry: resolve(process.cwd(), 'src/main.jsx'),
            name: 'CrayonShell',
            formats: ['iife'],
            fileName: () => 'crayonshell.iife.js',
            cssFileName: 'crayonshell'
        }
    }
}));
