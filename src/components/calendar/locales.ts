import type { LocaleInput } from "@fullcalendar/react";
import he from "@fullcalendar/react/locales/he";

// FullCalendar's own texts (toolbar buttons, "all day", "more") per app locale.
// Adding a language: import its FullCalendar locale here and add it to the map.
const LOCALES: Record<string, LocaleInput> = { he };

export function fullCalendarLocale(locale: string): LocaleInput {
  const found = LOCALES[locale];
  if (!found) throw new Error(`No FullCalendar locale for "${locale}" (see locales.ts)`);
  return found;
}
