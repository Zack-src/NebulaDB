// One self-contained file of the MCP server, `dist/nebuladb-mcp.mjs`: Node 22+ runs it with no
// install and no npm registry (`node nebuladb-mcp.mjs`). A NebulaDB instance serves it
// (`GET /api/mcp/nebuladb-mcp.mjs`, linked from Settings → AI agent), so connecting an agent does not
// depend on the package being published.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ["src/bin.ts"],
  outfile: "dist/nebuladb-mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  legalComments: "eof",
  // Some dependencies are CommonJS and call `require`: an ES module has none of its own.
  banner: {
    js: 'import { createRequire as __nebulaRequire } from "node:module"; const require = __nebulaRequire(import.meta.url);',
  },
  logLevel: "warning",
});
