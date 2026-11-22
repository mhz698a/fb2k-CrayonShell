import { access } from 'node:fs/promises';
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

console.log('\\nArchivos de producción verificados en: ' + outputDirectory);
