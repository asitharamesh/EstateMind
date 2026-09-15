import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Forwards relative /api/* calls to the FastAPI backend during `npm run
    // dev`, so the frontend never needs VITE_API_BASE_URL set (or CORS) for
    // local development - only set that env var to point at a different or
    // deployed backend.
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
        // Vite answers a refused upstream connection with a bare 500, which
        // the client could not tell apart from a real server bug. Answer 502
        // (no JSON body) instead - what a production gateway does - so the
        // UI classifies it as "backend unreachable" (see src/lib/api.ts).
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if ("writeHead" in res && !res.headersSent && !res.writableEnded) {
              res.writeHead(502, { "Content-Type": "text/plain" }).end("EstateMind API unreachable");
            }
          });
        },
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
