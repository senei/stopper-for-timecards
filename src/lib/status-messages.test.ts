import { describe, it, expect } from "vitest";
import {
  ERROR_INVALID_NAME,
  ERROR_PROJECT_IN_USE,
  STATUS_PROJECT_DELETED,
  errorMessage,
  statusMessage,
} from "./status-messages";

describe("errorMessage", () => {
  it("maps known error codes to their exact text", () => {
    expect(errorMessage(ERROR_INVALID_NAME)).toBe("That project name isn't valid.");
    expect(errorMessage(ERROR_PROJECT_IN_USE)).toBe("That project has logged time and can't be deleted.");
  });

  it("falls back to the generic message for an unknown error code", () => {
    expect(errorMessage("something-unrecognized")).toBe("Something went wrong. Please try again.");
  });

  it("returns null for a null error code", () => {
    expect(errorMessage(null)).toBeNull();
  });
});

describe("statusMessage", () => {
  it("maps the known status code to its exact text", () => {
    expect(statusMessage(STATUS_PROJECT_DELETED)).toBe("Project deleted.");
  });

  it("returns null for an unknown status code", () => {
    expect(statusMessage("something-unrecognized")).toBeNull();
  });

  it("returns null for a null status code", () => {
    expect(statusMessage(null)).toBeNull();
  });
});
