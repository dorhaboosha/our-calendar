import { describe, expect, it } from "vitest";
import { SHOW_ALL, isFiltered, isVisible, readFilters, toggle, writeFilters } from "./filters";

const OWNERS = ["dor", "maayan", "shared"];
const CATEGORIES = ["work", "vacation", "couple", "meeting", "personal", "other"];

describe("isVisible", () => {
  const dinner = { owner: "shared", category: "couple" };

  it("shows everything by default", () => {
    expect(isVisible(dinner, SHOW_ALL)).toBe(true);
    expect(isFiltered(SHOW_ALL)).toBe(false);
  });

  it("hides an event whose owner or category is hidden", () => {
    expect(isVisible(dinner, { hiddenOwners: ["shared"], hiddenCategories: [] })).toBe(false);
    expect(isVisible(dinner, { hiddenOwners: [], hiddenCategories: ["couple"] })).toBe(false);
    expect(isVisible(dinner, { hiddenOwners: ["dor"], hiddenCategories: ["work"] })).toBe(true);
  });
});

describe("toggle", () => {
  it("hides, then shows again, keeping the configured order", () => {
    const hidden = toggle(toggle([], "shared", OWNERS), "dor", OWNERS);
    expect(hidden).toEqual(["dor", "shared"]);
    expect(toggle(hidden, "dor", OWNERS)).toEqual(["shared"]);
  });
});

describe("readFilters / writeFilters", () => {
  it("round-trips through the URL, next to the view and date", () => {
    const filters = { hiddenOwners: ["maayan"], hiddenCategories: ["work", "other"] };
    const search = writeFilters("?view=week&date=2026-11-08", filters);
    expect(search).toBe("?view=week&date=2026-11-08&hideOwners=maayan&hideCategories=work%2Cother");
    expect(readFilters(search, OWNERS, CATEGORIES)).toEqual(filters);
  });

  it("showing everything removes the parameters", () => {
    expect(writeFilters("?view=month&hideOwners=dor&hideCategories=work", SHOW_ALL)).toBe(
      "?view=month",
    );
  });

  it("ignores unknown keys, and a missing or empty parameter", () => {
    expect(readFilters("?hideOwners=dor,someone,&hideCategories=", OWNERS, CATEGORIES)).toEqual({
      hiddenOwners: ["dor"],
      hiddenCategories: [],
    });
    expect(readFilters("", OWNERS, CATEGORIES)).toEqual(SHOW_ALL);
  });
});
