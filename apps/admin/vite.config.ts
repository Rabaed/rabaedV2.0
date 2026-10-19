import { fileURLToPath } from "node:url";
import { prepareArabicFont } from "@rabaed/ui/fonts";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Rabaed Admin's Workflows page (RP-443) and Imports page (RP-645, the Register Import wizard):
// the builder and the wizard from @rabaed/ui, built to dist/ and
// served by Rabaed Admin itself from /assets (src/routes/pages.ts), on its own origin and
// under its Content-Security-Policy: one script, one stylesheet, self-hosted fonts.

// Thmanyah Sans for Arabic when its private files are present, else IBM Plex Sans Arabic.
prepareArabicFont();

export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  base: "/assets/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    // Fonts stay files (the policy allows no data: fonts).
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    // Two pages: Workflows (RP-443) and Imports (RP-645), sharing their code in chunks/ and one stylesheet.
    rollupOptions: {
      input: {
        workflows: fileURLToPath(new URL("./web/main.tsx", import.meta.url)),
        imports: fileURLToPath(new URL("./web/imports-main.tsx", import.meta.url)),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (asset) => (asset.names.some((name) => name.endsWith(".css")) ? "workflows.css" : "fonts/[name][extname]"),
      },
    },
  },
});
