import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(dir, 'original.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'completion.css'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'completion.js'), 'utf8');
fs.writeFileSync(path.join(dir, 'index.html'), source.replace('</body></html>', () => `<style>${css}</style><script>${js}</script></body></html>`));
console.log('Maquette autonome reconstruite : index.html');
