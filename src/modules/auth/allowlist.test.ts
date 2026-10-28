import { describe, expect, it } from "vitest";
import { emailEnvVar, findAllowedUserKey, getAllowedEmails } from "./allowlist";

const env = {
  USER_EMAIL_DOR: "Dor@Example.com",
  USER_EMAIL_MAAYAN: " maayan@example.com ",
};

describe("emailEnvVar", () => {
  it("builds the env var name from the user key", () => {
    expect(emailEnvVar("maayan")).toBe("USER_EMAIL_MAAYAN");
  });
});

describe("getAllowedEmails", () => {
  it("maps each normalized email to its user key", () => {
    expect([...getAllowedEmails(env)]).toEqual([
      ["dor@example.com", "dor"],
      ["maayan@example.com", "maayan"],
    ]);
  });

  it("throws when a user's email is missing", () => {
    expect(() => getAllowedEmails({ USER_EMAIL_DOR: "dor@example.com" })).toThrow(
      "USER_EMAIL_MAAYAN",
    );
  });

  it("throws when a value is not an email", () => {
    expect(() => getAllowedEmails({ ...env, USER_EMAIL_DOR: "replace-me" })).toThrow(
      "USER_EMAIL_DOR",
    );
  });

  it("throws when both users have the same email", () => {
    expect(() =>
      getAllowedEmails({
        USER_EMAIL_DOR: "same@example.com",
        USER_EMAIL_MAAYAN: "SAME@example.com",
      }),
    ).toThrow("USER_EMAIL_MAAYAN");
  });
});

describe("findAllowedUserKey", () => {
  it("matches regardless of case and surrounding spaces", () => {
    expect(findAllowedUserKey("  DOR@example.COM", env)).toBe("dor");
    expect(findAllowedUserKey("maayan@example.com", env)).toBe("maayan");
  });

  it("returns undefined for any other email or no email", () => {
    expect(findAllowedUserKey("stranger@example.com", env)).toBeUndefined();
    expect(findAllowedUserKey("dor@example.com.evil.com", env)).toBeUndefined();
    expect(findAllowedUserKey("", env)).toBeUndefined();
    expect(findAllowedUserKey(null, env)).toBeUndefined();
  });
});
