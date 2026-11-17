import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Los tests de base de datos recrean el esquema: se ejecutan los ficheros de uno en uno.
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});
