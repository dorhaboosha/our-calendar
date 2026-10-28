import { describe, expect, it } from "vitest";
import he from "../../messages/he.json";
import { appConfig, getUserConfig } from "./app.config";

const HEX = /^#[0-9a-f]{6}$/;

describe("appConfig", () => {
  it("is Hebrew, right-to-left, in Israel time", () => {
    expect(appConfig.locale).toBe("he");
    expect(appConfig.direction).toBe("rtl");
    expect(appConfig.timeZone).toBe("Asia/Jerusalem");
  });

  it("has exactly the two users, with unique keys", () => {
    expect(appConfig.users.map((user) => user.key)).toEqual(["dor", "maayan"]);
    expect(appConfig.users.map((user) => user.displayName)).toEqual(["דור", "מעיין"]);
  });

  it("uses lower-case 6-digit hex for every color", () => {
    const colors = [
      appConfig.sharedColor,
      ...appConfig.users.map((user) => user.defaultColor),
      ...appConfig.categories.map((category) => category.color),
      ...appConfig.colorPalette,
    ];
    for (const color of colors) expect(color).toMatch(HEX);
  });

  it("gives each user and shared events a different default color", () => {
    const colors = [appConfig.sharedColor, ...appConfig.users.map((user) => user.defaultColor)];
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("has unique category keys, a Hebrew label for each, and a valid default", () => {
    const keys = appConfig.categories.map((category) => category.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(he.categories[key as keyof typeof he.categories], key).toBeTruthy();
    }
    expect(keys).toContain(appConfig.defaultCategory);
  });
});

describe("getUserConfig", () => {
  it("finds a user by key and returns undefined for unknown keys", () => {
    expect(getUserConfig("maayan")?.displayName).toBe("מעיין");
    expect(getUserConfig("someone")).toBeUndefined();
  });
});
