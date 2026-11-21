import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function staticFiles(directory) {
  const root = realpath(directory);
  return async (pathname, method) => {
    if (!['GET', 'HEAD'].includes(method)) return { status: 405 };
    let name;
    try { name = decodeURIComponent(pathname); } catch { return { status: 400 }; }
    if (name === '/') name = '/index.html';
    if (name.includes('\\') || name.split('/').some(part => part.startsWith('.'))) return { status: 404 };
    const type = TYPES[path.extname(name)];
    if (!type) return { status: 404 };
    const folder = await root;
    try {
      const filename = await realpath(path.join(folder, name));
      if (!filename.startsWith(folder + path.sep) || !(await stat(filename)).isFile()) return { status: 404 };
      const body = await readFile(filename);
      return { status: 200, body: method === 'HEAD' ? null : body, headers: { 'content-type': type, 'content-length': body.length } };
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return { status: 404 };
      throw error;
    }
  };
}
