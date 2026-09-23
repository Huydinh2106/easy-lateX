import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ["electron"],
      input: { preload: "src/preload/index.ts" },
      output: {
        format: "cjs",
        inlineDynamicImports: true,
        entryFileNames: "preload.js",
        chunkFileNames: "preload.js"
      }
    }
  }
});
