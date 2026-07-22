import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// multi-page build: the shop pages are separate static HTML entries
// alongside the main cinematic site, not client-side routes
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        shopIndex: resolve(root, "shop/index.html"),
        shopCategory: resolve(root, "shop/category.html"),
        shopProduct: resolve(root, "shop/product.html"),
      },
    },
  },
});
