import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve("mobile/web"),
  base: "./",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: path.resolve("standalone/.build"),
    emptyOutDir: true,
    target: "es2020",
    cssCodeSplit: false,
  },
});
