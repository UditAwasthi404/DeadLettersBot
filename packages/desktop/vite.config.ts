import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  // Read CLERK_PUBLISHABLE_KEY from the repository .env without exposing CLERK_SECRET_KEY.
  envDir: "../..",
  envPrefix: ["VITE_", "CLERK_PUBLISHABLE_KEY", "CLERK_MOCK"],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  plugins: [
    {
      name: "dev-csp",
      apply: "serve",
      transformIndexHtml(html) {
        return html.replace(
          /connect-src ([^;]+);/,
          (_directive, sources: string) =>
            `connect-src ${sources} http://127.0.0.1:5173 ws://127.0.0.1:5173;`,
        );
      },
    },
  ],
});
