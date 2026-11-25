import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "url";
import { readFileSync } from "fs";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["locales/**/*.json"],
      manifest: {
        name: "Polly - Garden Planner",
        short_name: "Polly",
        description: "Self-sufficiency garden planner for vegetables, fruit, berries and herbs",
        theme_color: "#15803d",
        background_color: "#f0fdf0",
        display: "standalone",
        start_url: ".",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,json,png,svg,woff2}"],
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: "index.html",
        // Translations are requested with ?v=<build id>; the precache entry is the same file.
        ignoreURLParametersMatching: [/^v$/, /^utm_/, /^fbclid$/],
        runtimeCaching: [
          {
            urlPattern: /assets\/.*\.(js|css)$/,
            handler: "CacheFirst",
            options: { cacheName: "assets-cache", expiration: { maxEntries: 60, maxAgeSeconds: 86400 * 30 } },
          },
          {
            urlPattern: /locales\/.*\.json$/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "translations-cache", expiration: { maxEntries: 10, maxAgeSeconds: 86400 * 30 } },
          },
          {
            urlPattern: /api\.open-meteo\.com\/v1\/forecast|api\.openweathermap\.org/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "weather-cache", expiration: { maxEntries: 5, maxAgeSeconds: 3600 } },
          },
        ],
      },
    }),
  ],
  // Shown under Settings → "Über Polly" (the stores ask for a visible version).
  define: {
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
    __APP_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/**/*.d.ts", "src/main.tsx", "src/lib/i18n.ts"],
      reporter: ["text-summary", "html"],
    },
  },
});
