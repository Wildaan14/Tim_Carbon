import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "../public",
  server: {
    fs: { strict: false },
  },
});
