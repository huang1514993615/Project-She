import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve("mobile/web"),
  base: "./",
  publicDir: path.resolve("public"),
  plugins: [react()],
  build: {
    outDir: path.resolve("uniapp/hybrid/html"),
    emptyOutDir: true,
    target: "es2020",
  },
});
