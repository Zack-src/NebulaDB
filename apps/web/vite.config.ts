import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import type { Socket } from "node:net";

/** Node error shape as it reaches the proxy hooks: `code` sometimes sits on the cause. */
interface MaybeNodeError {
  code?: string;
  cause?: { code?: string };
  message?: string;
}

const isAbortedError = (err: unknown) => {
  if (!err || typeof err !== "object") return false;
  const { code: ownCode, cause, message = "" } = err as MaybeNodeError;
  const code = ownCode || cause?.code;
  return (
    code === "ECONNABORTED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    message.includes("ECONNABORTED") ||
    message.includes("ECONNRESET") ||
    message.includes("EPIPE")
  );
};

// Overridable so more than one checkout (e.g. a second git worktree) can run
// the dev stack side by side without both binding the same ports. Defaults
// match the values every existing setup already expects.
const WEB_PORT = Number(process.env.VITE_WEB_PORT) || 5173;
const API_PORT = Number(process.env.VITE_API_PORT) || 3001;

export default defineConfig({
  plugins: [react(), svgr()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        // React Flow and CodeMirror are both large, independently-cacheable
        // dependencies that were otherwise landing in the main `index` chunk
        // (they're imported statically by the canvas and DBML editor, which
        // render as soon as a project opens, so route-level lazy() wouldn't
        // help). Splitting them into their own vendor chunks doesn't shrink
        // what a project view downloads overall, but it keeps the app-code
        // chunk small and lets these rarely-changing dependency chunks be
        // cached across deploys independently of app code and of each other.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // @xyflow/react and its own dependency tree (the @xyflow/system
          // helper package plus the d3-* modules it uses for zoom/drag/pan)
          // and @dagrejs/dagre, which the canvas only imports for
          // auto-layout alongside React Flow.
          if (
            id.includes("node_modules/@xyflow") ||
            id.includes("node_modules/@dagrejs/dagre") ||
            id.includes("/node_modules/d3-")
          ) {
            return "xyflow";
          }

          // The @codemirror/* family plus the @lezer/* parser packages and
          // small helper libs (style-mod, crelt, w3c-keyname,
          // @marijn/find-cluster-break) they pull in. Bundled together since
          // they're only ever used together, by the DBML editor.
          if (
            id.includes("node_modules/@codemirror") ||
            id.includes("node_modules/@lezer") ||
            id.includes("node_modules/style-mod") ||
            id.includes("node_modules/crelt") ||
            id.includes("node_modules/w3c-keyname") ||
            id.includes("node_modules/@marijn/find-cluster-break")
          ) {
            return "codemirror";
          }

          // Yjs plus its lib0 utility library and the y-protocols wire
          // format: the realtime-sync stack, only needed once a project is
          // open and independent of both the editor and the canvas above.
          if (
            id.includes("node_modules/yjs") ||
            id.includes("node_modules/y-protocols") ||
            id.includes("node_modules/lib0")
          ) {
            return "yjs";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: WEB_PORT,
    // Bind all interfaces so other machines on LAN reach dev server, not just localhost.
    host: true,
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        // The server's CSRF defence (apps/server/src/index.ts) compares the
        // browser's `Origin` header against the `Host` header it actually
        // received. node-http-proxy rewrites `Host` to the proxy *target*
        // by default regardless of `changeOrigin`, so every state-changing
        // request (login included) arrived at the server as
        // `Origin: localhost:5173` / `Host: localhost:3001` and got a 403 —
        // dev-only breakage the production build never hits (one process,
        // one origin, no proxy). Force the original inbound Host back onto
        // the proxied request so it matches what the browser actually sees.
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader("host", req.headers.host);
          });
        },
      },
      "/ws": {
        target: `ws://localhost:${API_PORT}`,
        ws: true,
        configure: (proxy) => {
          proxy.on("proxyReqWs", (_proxyReq, _req, socket: Socket) => {
            if (socket) {
              const origEmit = socket.emit;
              socket.emit = function (event: string | symbol, ...args: unknown[]) {
                if (event === "error" && isAbortedError(args[0])) {
                  return false;
                }
                return origEmit.apply(this, [event, ...args] as [string | symbol, ...unknown[]]);
              };
            }
          });

          proxy.on("error", (err) => {
            if (isAbortedError(err)) return;
          });

          const origEmit = proxy.emit;
          proxy.emit = function (event: string | symbol, ...args: unknown[]) {
            if (event === "error" && isAbortedError(args[0])) {
              return false;
            }
            return origEmit.apply(this, [event, ...args] as [string | symbol, ...unknown[]]);
          };
        },
      },
    },
  },
});
