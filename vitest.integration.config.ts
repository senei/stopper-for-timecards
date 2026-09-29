import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Opt-in integration run (`npm run test:integration`): exercises real code against the local Supabase stack.
// `astro:env/server` only resolves inside Astro's Vite pipeline, so it is aliased to a stub that reads process.env.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "astro:env/server": fileURLToPath(new URL("./src/test/astro-env-server-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
  },
});
