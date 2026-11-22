import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve, join } from 'node:path';
import config from '../vite.config.js';

const configuredOutDir = config.build?.outDir || 'dist';
const outputDirectory = isAbsolute(configuredOutDir)
    ? configuredOutDir
    : resolve(process.cwd(), configuredOutDir);

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

const bundle = await readFile(join(outputDirectory, 'crayonshell.iife.js'), 'utf8');

if (/\bprocess\.env\.NODE_ENV\b/.test(bundle)) {
    throw new Error(
        'El bundle conserva process.env.NODE_ENV, que no existe en el navegador WebView2.'
    );
}

console.log('OK  bundle sin referencias a process.env.NODE_ENV');
console.log('\nArchivos de producción verificados en: ' + outputDirectory);
