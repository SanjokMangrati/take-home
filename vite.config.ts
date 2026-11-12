import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const API_SERVER = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": API_SERVER,
      "/samples": API_SERVER,
    },
  },
  test: {
    unstubGlobals: true,
    projects: [
      {
        test: {
          name: "core",
          include: ["tests/core/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "server",
          include: ["tests/server/**/*.test.ts"],
          environment: "node",
          env: loadEnv("development", import.meta.dirname, ""),
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "ui",
          include: ["tests/ui/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
