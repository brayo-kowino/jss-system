import { defineConfig } from "vitest/config";

export default defineConfig({
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
