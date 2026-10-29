import { cpSync, mkdirSync, rmSync } from 'node:fs';
rmSync('pages-dist', { recursive: true, force: true });
mkdirSync('pages-dist', { recursive: true });
cpSync('public', 'pages-dist', { recursive: true });
cpSync('index.html', 'pages-dist/index.html');
console.log('GitHub Pages output: pages-dist/');
