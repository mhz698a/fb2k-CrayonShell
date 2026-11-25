import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { buildOutputDirectory } from '../vite.config.js';

const outputDirectory = buildOutputDirectory;

const requiredFiles = [
    'index.html',
    'crayonshell.iife.js',
    'crayonshell.css'
];

const missingFiles = [];

for (const fileName of requiredFiles) {
    try {
        await access(join(outputDirectory, fileName), constants.R_OK);
        console.log('OK  ' + fileName);
    } catch {
        missingFiles.push(fileName);
        console.error('FALTA  ' + fileName);
    }
}

if (missingFiles.length > 0) {
    throw new Error(
        'La compilación no generó todos los archivos requeridos en: '
        + outputDirectory
    );
}

const html = await readFile(join(outputDirectory, 'index.html'), 'utf8');
const expectedReferences = [
    './crayonshell.iife.js',
    './crayonshell.css'
];

for (const reference of expectedReferences) {
    if (!html.includes(reference)) {
        throw new Error('index.html no referencia el archivo: ' + reference);
    }
    console.log('OK  index.html referencia ' + reference);
}

const css = await readFile(join(outputDirectory, 'crayonshell.css'), 'utf8');

if (!/font-family:[^;]*FontAwesome/i.test(css)
    || !/fontawesome-webfont[^)]*\\.(woff2|woff)/i.test(css)) {
    throw new Error(
        'La compilación no incluye Font Awesome 4 ni la referencia a su fuente local.'
    );
}

console.log('OK  Font Awesome 4 y su fuente local están incluidos en el CSS');

const bundle = await readFile(join(outputDirectory, 'crayonshell.iife.js'), 'utf8');

if (/\bprocess\.env\.NODE_ENV\b/.test(bundle)) {
    throw new Error(
        'El bundle conserva process.env.NODE_ENV, que no existe en el navegador WebView2.'
    );
}

console.log('OK  bundle sin referencias a process.env.NODE_ENV');
console.log('\nArchivos de producción verificados en: ' + outputDirectory);
