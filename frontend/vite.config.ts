import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    /*
     * The installable app (App Plan: "a progressive web app, installed from a
     * WhatsApp link, that updates itself"). `autoUpdate` swaps in a new
     * version on the next open without asking anyone to do anything.
     */
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Junta de Agua Zoilabe",
        short_name: "Agua Zoilabe",
        description: "Censo, cobros e historial de la Junta de Agua de Zoilabe.",
        lang: "es-HN",
        start_url: "/",
        display: "standalone",
        background_color: "#f4f7fa",
        theme_color: "#0b5c8c",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // The API is never served from the cache: a stale answer about money
        // or permissions is worse than "no signal".
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Reachable from a phone on the same Wi-Fi: http://<computer's IP>:5173
    host: true,
    // Vite answers "Blocked request" to hostnames it does not know. This one is
    // GitHub Codespaces' address (name-5173.app.github.dev), where a branch is
    // tried from a phone before merging (.devcontainer/).
    allowedHosts: [".app.github.dev"],
    proxy: {
      // Same origin for the browser, so the sign-in cookies just work.
      "/api": "http://127.0.0.1:3002",
    },
  },
});
