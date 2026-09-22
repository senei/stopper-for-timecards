/**
 * The owner's close-registration switch: creation is closed when the
 * LINK_CREATION_CLOSED secret is `1` or `true` (case-insensitive, whitespace ignored).
 * Unset, empty or any other value means open.
 */
export function isCreationClosed(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}
