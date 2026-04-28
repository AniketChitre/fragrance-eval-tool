import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/fragrance-eval-tool/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["data/application_codes.csv", "data/booth_conditions.csv", "protocol.txt"],
      manifest: {
        name: "Fragrance Evaluation Tool",
        short_name: "FragEval",
        description: "Voice-first booth-based fragrance evaluation logger",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: process.env.GITHUB_ACTIONS ? "/fragrance-eval-tool/" : "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,csv,txt}"]
      }
    })
  ],
  test: {
    globals: true,
    environment: "jsdom"
  },
  server: {
    host: true,
    port: 5173
  }
});
