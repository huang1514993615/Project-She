import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve("."),
  base: "./",
  publicDir: false,
  build: {
    outDir: path.resolve("standalone/.build"),
    emptyOutDir: true,
    target: "es2020",
    cssCodeSplit: false,
  },
});
