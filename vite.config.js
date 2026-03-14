import { defineConfig } from "vite";

export default defineConfig({
  // Folder public/ → semua file di sini serve langsung tanpa transformasi
  publicDir: "public",
  server: {
    fs: { strict: false },
  },
});
