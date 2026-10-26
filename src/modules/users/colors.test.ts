import { describe, expect, it } from "vitest";
import { appConfig } from "@/config/app.config";
import {
  MIN_BACKGROUND_CONTRAST,
  checkUserColor,
  colorDistance,
  contrastRatio,
  isHexColor,
  textColorFor,
} from "./colors";

describe("isHexColor", () => {
  it("accepts 6-digit hex in either case", () => {
    expect(isHexColor("#1d4ed8")).toBe(true);
    expect(isHexColor("#1D4ED8")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["1d4ed8", "#1d4", "#1d4ed8ff", "#gggggg", "blue", "", "#1d4ed8;x"]) {
      expect(isHexColor(value)).toBe(false);
    }
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("textColorFor", () => {
  it("picks white on dark colors and black on light ones", () => {
    expect(textColorFor("#1d4ed8")).toBe("#ffffff");
    expect(textColorFor("#fde047")).toBe("#000000");
  });
});

describe("colorDistance", () => {
  it("is zero for the same color and large for very different ones", () => {
    expect(colorDistance("#1d4ed8", "#1D4ED8")).toBe(0);
    expect(colorDistance("#1d4ed8", "#be185d")).toBeGreaterThan(50);
    expect(colorDistance("#1d4ed8", "#1e4fd9")).toBeLessThan(2);
  });
});

describe("checkUserColor", () => {
  const others = { מעיין: "#be185d", משותף: "#047857" };

  it("accepts a distinct, visible color and lower-cases it", () => {
    expect(checkUserColor("#1D4ED8", others)).toEqual({ ok: true, color: "#1d4ed8" });
  });

  it("rejects invalid values", () => {
    expect(checkUserColor("red", others)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects colors too light to see on the white page", () => {
    expect(checkUserColor("#ffffff", others)).toEqual({ ok: false, reason: "tooLight" });
    expect(checkUserColor("#fde047", others)).toEqual({ ok: false, reason: "tooLight" });
  });

  it("rejects a color too close to another calendar color, naming it", () => {
    expect(checkUserColor("#bf195e", others)).toEqual({
      ok: false,
      reason: "tooSimilar",
      conflictWith: "מעיין",
    });
    expect(checkUserColor("#047857", others)).toEqual({
      ok: false,
      reason: "tooSimilar",
      conflictWith: "משותף",
    });
  });
});

describe("app.config.ts colors", () => {
  it("every preset swatch is visible on the white page", () => {
    for (const color of appConfig.colorPalette) {
      expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(MIN_BACKGROUND_CONTRAST);
    }
  });

  it("each default user color passes the rules against the other defaults", () => {
    const [dor, maayan] = appConfig.users;
    expect(
      checkUserColor(dor.defaultColor, {
        other: maayan.defaultColor,
        shared: appConfig.sharedColor,
      }).ok,
    ).toBe(true);
    expect(
      checkUserColor(maayan.defaultColor, {
        other: dor.defaultColor,
        shared: appConfig.sharedColor,
      }).ok,
    ).toBe(true);
  });
});
