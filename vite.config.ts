import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

/**
 * 标准云部署构建。
 * 输出完全静态的 dist/，用户访问后由浏览器直接运行，不需要服务端。
 */
export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [sites()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
});
