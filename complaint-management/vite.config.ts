import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: { plugins: [] },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
