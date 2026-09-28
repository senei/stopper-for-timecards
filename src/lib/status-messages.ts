export const ERROR_INVALID_NAME = "invalid-name";
export const ERROR_PROJECT_IN_USE = "project-in-use";
export const ERROR_GENERIC = "1";
export const STATUS_PROJECT_DELETED = "project-deleted";
export const STATUS_LINK_REGENERATED = "link-regenerated";

export function errorMessage(code: string | null): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    [ERROR_INVALID_NAME]: "That project name isn't valid.",
    [ERROR_PROJECT_IN_USE]: "That project has logged time and can't be deleted.",
  };
  return messages[code] ?? "Something went wrong. Please try again.";
}

export function statusMessage(code: string | null): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    [STATUS_PROJECT_DELETED]: "Project deleted.",
    [STATUS_LINK_REGENERATED]: "Your link was regenerated — save the new one now.",
  };
  return messages[code] ?? null;
}
