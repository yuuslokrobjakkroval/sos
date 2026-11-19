import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During web development, /api calls go to the Rust server on port 8787.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
