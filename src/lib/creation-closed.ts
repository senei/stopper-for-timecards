export type KillSwitchState = "closed" | "open" | "unrecognised";

/**
 * Reads the owner's close-registration switch (the LINK_CREATION_CLOSED secret) in three states, after trimming and
 * lowercasing: `1` and `true` are `closed`; unset, empty, `0`, `false`, `no` and `off` are `open` (a deliberate "off");
 * anything else, such as `yes` or `on`, is `unrecognised`, which still leaves sign-up open but is worth reporting.
 */
export function classifyKillSwitch(value: string | undefined): KillSwitchState {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return "closed";
  }
  if (normalized === undefined || ["", "0", "false", "no", "off"].includes(normalized)) {
    return "open";
  }
  return "unrecognised";
}

/** Creation is closed only for `1` or `true` (see `classifyKillSwitch`); every other value, recognised or not, is open. */
export function isCreationClosed(value: string | undefined): boolean {
  return classifyKillSwitch(value) === "closed";
}
