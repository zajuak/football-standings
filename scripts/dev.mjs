import './build-pages.mjs';
import { spawn } from 'node:child_process';
const server = spawn('python3', ['-m', 'http.server', '8081', '--bind', '127.0.0.1', '--directory', 'pages-dist'], { stdio: 'inherit' });
process.on('SIGINT', () => server.kill('SIGINT'));
