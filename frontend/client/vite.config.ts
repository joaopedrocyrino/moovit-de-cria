import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, "../.."), "");
  return {
    envDir: path.resolve(__dirname, "../.."),
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT || 4193),
      strictPort: true,
      proxy: { "/api": { target: `http://127.0.0.1:${env.API_PORT || 5193}` } },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            map: ["leaflet"],
            query: ["@tanstack/react-query"],
          },
        },
      },
    },
  };
});
