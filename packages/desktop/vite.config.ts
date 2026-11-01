import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  plugins: [
    {
      name: "dev-csp",
      apply: "serve",
      transformIndexHtml(html) {
        return html.replace("connect-src 'none'", "connect-src 'self'");
      },
    },
  ],
});
