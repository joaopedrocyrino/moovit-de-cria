import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "../..");
  const env = loadEnv(mode, envDir, "");
  return {
    envDir,
    plugins: [react()],
    server: { port: Number(env.ADMIN_WEB_PORT || 4194), strictPort: true },
  };
});
