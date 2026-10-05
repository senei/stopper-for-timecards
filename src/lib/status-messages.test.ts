import { describe, it, expect } from "vitest";
import {
  ERROR_CONFIRM_PHRASE,
  ERROR_ENTRY_IN_FUTURE,
  ERROR_ENTRY_OUTSIDE_WINDOW,
  ERROR_ENTRY_OVERLAP,
  ERROR_ENTRY_RANGE,
  ERROR_ENTRY_RUNNING,
  ERROR_ENTRY_TIME_INVALID,
  ERROR_INVALID_NAME,
  ERROR_PROJECT_IN_USE,
  STATUS_ACCOUNT_DELETED,
  STATUS_ENTRY_CORRECTED,
  STATUS_ENTRY_DELETED,
  STATUS_PROJECT_DELETED,
  STATUS_TIMER_STOPPED,
  errorMessage,
  statusMessage,
} from "./status-messages";

describe("errorMessage", () => {
  it("maps known error codes to their exact text", () => {
    expect(errorMessage(ERROR_INVALID_NAME)).toBe("That project name isn't valid.");
    expect(errorMessage(ERROR_PROJECT_IN_USE)).toBe("That project has logged time and can't be deleted.");
    expect(errorMessage(ERROR_CONFIRM_PHRASE)).toBe("Type DELETE exactly to confirm.");
  });

  it("maps the correction error codes to their exact text", () => {
    expect(errorMessage(ERROR_ENTRY_TIME_INVALID)).toBe("Enter both times as a UTC date and time.");
    expect(errorMessage(ERROR_ENTRY_RANGE)).toBe("The end must be after the start.");
    expect(errorMessage(ERROR_ENTRY_OVERLAP)).toBe(
      "That time overlaps another entry or the running timer. Shorten the other one first.",
    );
    expect(errorMessage(ERROR_ENTRY_OUTSIDE_WINDOW)).toBe(
      "Only entries from today and yesterday (UTC) can be corrected.",
    );
    expect(errorMessage(ERROR_ENTRY_IN_FUTURE)).toBe("The end can't be in the future.");
    expect(errorMessage(ERROR_ENTRY_RUNNING)).toBe("Stop the running timer first; then you can correct it.");
  });

  it("falls back to the generic message for an unknown error code", () => {
    expect(errorMessage("something-unrecognized")).toBe("Something went wrong. Please try again.");
  });

  it("returns null for a null error code", () => {
    expect(errorMessage(null)).toBeNull();
  });
});

describe("statusMessage", () => {
  it("maps the known status codes to their exact text", () => {
    expect(statusMessage(STATUS_PROJECT_DELETED)).toBe("Project deleted.");
    expect(statusMessage(STATUS_TIMER_STOPPED)).toBe("Timer stopped.");
    expect(statusMessage(STATUS_ACCOUNT_DELETED)).toBe("Your data and link were permanently deleted.");
    expect(statusMessage(STATUS_ENTRY_CORRECTED)).toBe("Entry corrected.");
    expect(statusMessage(STATUS_ENTRY_DELETED)).toBe("Entry deleted.");
  });

  it("returns null for an unknown status code", () => {
    expect(statusMessage("something-unrecognized")).toBeNull();
  });

  it("returns null for a null status code", () => {
    expect(statusMessage(null)).toBeNull();
  });
});
