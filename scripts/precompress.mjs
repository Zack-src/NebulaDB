// Writes a brotli (.br) and a gzip (.gz) copy next to every compressible file of a built web app, for
// @fastify/static's `preCompressed` option to serve. Run after `vite build`:  node scripts/precompress.mjs <dir>
//
// Done once at build time, at the best quality: the server then sends the smaller file as it is, with no
// per-request compression cost. Files that do not get smaller are left alone.
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|txt|xml)$/;
const MIN_BYTES = 1024;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const root = path.resolve(process.argv[2] ?? "dist");
const files = [];
for await (const file of walk(root)) if (COMPRESSIBLE.test(file)) files.push(file);

let before = 0, afterBr = 0, afterGz = 0, count = 0;
await Promise.all(
  files.map(async (file) => {
    const data = await fs.readFile(file);
    if (data.length < MIN_BYTES) return;
    const [br, gz] = await Promise.all([
      brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
      gzip(data, { level: 9 }),
    ]);
    before += data.length;
    count++;
    if (br.length < data.length) { await fs.writeFile(`${file}.br`, br); afterBr += br.length; } else afterBr += data.length;
    if (gz.length < data.length) { await fs.writeFile(`${file}.gz`, gz); afterGz += gz.length; } else afterGz += data.length;
  }),
);
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`precompress: ${count} files, ${kb(before)} -> ${kb(afterBr)} brotli, ${kb(afterGz)} gzip`);
