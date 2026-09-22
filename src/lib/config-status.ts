import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
    message: "Supabase is not configured — creating and opening links is disabled.",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
