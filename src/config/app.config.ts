// Non-secret application settings. Secrets and user emails live in environment
// variables (see .env.example). UI text lives in messages/<locale>.json.

export type UserConfig = {
  /** Stable id. The user's email comes from env var USER_EMAIL_<KEY in upper case>. */
  key: string;
  displayName: string;
  defaultColor: string;
};

export type CategoryConfig = {
  /** Stable id stored in the database. The label is messages: categories.<key>. */
  key: string;
  color: string;
};

export type AppConfig = {
  locale: string;
  /** BCP 47 tag for date/number formatting and the Chakra (Ark UI) locale. */
  intlLocale: string;
  direction: "rtl" | "ltr";
  timeZone: string;
  users: readonly UserConfig[];
  sharedColor: string;
  categories: readonly CategoryConfig[];
  defaultCategory: string;
  /** Preset swatches offered on the settings screen. */
  colorPalette: readonly string[];
};

export const appConfig = {
  locale: "he",
  intlLocale: "he-IL",
  direction: "rtl",
  timeZone: "Asia/Jerusalem",
  users: [
    { key: "dor", displayName: "דור", defaultColor: "#1d4ed8" },
    { key: "maayan", displayName: "מעיין", defaultColor: "#be185d" },
  ],
  sharedColor: "#047857",
  categories: [
    { key: "work", color: "#475569" },
    { key: "vacation", color: "#0891b2" },
    { key: "couple", color: "#db2777" },
    { key: "meeting", color: "#7c3aed" },
    { key: "personal", color: "#ea580c" },
    { key: "other", color: "#64748b" },
  ],
  defaultCategory: "other",
  colorPalette: [
    "#1d4ed8",
    "#0e7490",
    "#4338ca",
    "#7e22ce",
    "#be185d",
    "#b91c1c",
    "#c2410c",
    "#a16207",
    "#4d7c0f",
    "#334155",
  ],
} as const satisfies AppConfig;

export function getUserConfig(key: string): UserConfig | undefined {
  return appConfig.users.find((user) => user.key === key);
}
