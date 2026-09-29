// Stand-in for Astro's virtual `astro:env/server` module, used only by vitest.integration.config.ts.
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
