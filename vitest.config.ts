import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only the project's own tests run here. Agent skills under .claude/ ship their own
// node:test files, which vitest would otherwise pick up and report as empty suites.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Integration tests need the local Supabase stack; run them with `npm run test:integration`.
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
