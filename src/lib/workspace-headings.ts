export interface WorkspaceHeading {
  /** Shown while no timer runs. */
  idle: string;
  /** Shown while a timer runs. */
  tracking: string;
}

/** One pair per day, in a fixed shuffled order; the cycle repeats every `length` days. */
export const WORKSPACE_HEADINGS: readonly WorkspaceHeading[] = [
  { idle: "Where did the day go?", tracking: "Right here. Don't blink." },
  { idle: "Friday-you will thank you", tracking: "Friday-you says thanks" },
  { idle: "Tick. Tock. Pick a project.", tracking: "Tick. Tock. Still going." },
  { idle: "Ready, set, bill.", tracking: "Billing in progress" },
  { idle: "No accounts. No judgment.", tracking: "No judgment. Just minutes." },
  { idle: "Time flies. Let's catch it.", tracking: "Caught it. Hold tight." },
];

const MS_PER_DAY = 86_400_000;

/**
 * Index of the pair for the calendar day of `date`. The day is read with the Date's local getters (on the server
 * that is UTC, in the browser the viewer's date), so the same day always gives the same index and consecutive days
 * never repeat.
 */
export function headingIndexForDate(date: Date): number {
  const dayNumber = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
  const count = WORKSPACE_HEADINGS.length;
  return ((dayNumber % count) + count) % count;
}

/** The pair at `index`, wrapped into range so any integer is safe. */
export function headingAtIndex(index: number): WorkspaceHeading {
  const count = WORKSPACE_HEADINGS.length;
  return WORKSPACE_HEADINGS[((index % count) + count) % count];
}

/** Today's heading pair for the day `date` falls on. */
export function headingForDate(date: Date): WorkspaceHeading {
  return headingAtIndex(headingIndexForDate(date));
}
