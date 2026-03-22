import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: {
    fs: { strict: false },
  },
});
