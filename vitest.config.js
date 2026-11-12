import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify("1.0.0"),
    __APP_BUILD_ID__: JSON.stringify("test-build-id"),
    __APP_BUILD_TIME__: JSON.stringify("2026-11-10T00:00:00.000Z"),
  },
  resolve: {
    alias: [
      {
        find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js$/,
        replacement: "firebase/app",
      },
      {
        find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js$/,
        replacement: "firebase/auth",
      },
      {
        find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-firestore\.js$/,
        replacement: "firebase/firestore",
      },
      {
        find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app-check\.js$/,
        replacement: "firebase/app-check",
      },
      {
        find: /^https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js.*$/,
        replacement: "chart.js/auto",
      },
    ],
  },
  test: {
    globals: true,
    environment: "happy-dom",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.{js,ts}"],
  },
});
