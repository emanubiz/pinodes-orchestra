import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const BACKEND_PORT = process.env.PINODES_ORCHESTRA_PORT ?? "3847";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Registration is done manually in main.tsx so we can skip it (and tear
      // down any existing SW) when embedded in a host like the VS Code webview.
      injectRegister: null,
      manifest: {
        name: "PiNodes Orchestra",
        short_name: "PiNodes Orchestra",
        description: "Visual multi-agent pi console orchestrator",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${BACKEND_PORT}`,
      "/ws": { target: `ws://localhost:${BACKEND_PORT}`, ws: true },
    },
  },
});
