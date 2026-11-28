import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/he.json";
import {
  type ExportContext,
  type ExportEvent,
  type ExportException,
  GOOGLE_EVENT_COLORS,
  googleEventId,
  instanceId,
  instanceUpdates,
  nearestColorId,
  toGoogleEvent,
} from "./mapping";

const t = createTranslator({ locale: "he", messages, namespace: "googleExport" });

const context: ExportContext = {
  ownerNames: { dor: "דור", maayan: "מעיין" },
  colors: { dor: "#1d4ed8", maayan: "#be185d", shared: "#047857" },
  ownedTitle: (owner, title) => t("ownedTitle", { owner, title }),
};

const ID = "0f8e7d6c-5b4a-4398-8776-655443322110";
const GOOGLE_ID = "0f8e7d6c5b4a43988776655443322110";

const dentist: ExportEvent = {
  id: ID,
  version: 3,
  title: "רופא שיניים",
  description: null,
  location: "תל אביב",
  category: "personal",
  owner: "dor",
  isAllDay: false,
  start: "2026-11-05T08:00:00.000Z",
  end: "2026-11-05T09:30:00.000Z",
  timezone: "Asia/Jerusalem",
  rrule: null,
  exceptions: [],
};

describe("ids", () => {
  it("the Google id is the local UUID's hex digits", () => {
    expect(googleEventId(ID)).toBe(GOOGLE_ID);
    expect(googleEventId(ID.toUpperCase())).toBe(GOOGLE_ID);
    expect(() => googleEventId("not-an-id!")).toThrow();
  });

  it("an occurrence's id is the series' id and its original start in UTC, or its date", () => {
    expect(instanceId(GOOGLE_ID, "2026-11-05T08:00:00.000Z")).toBe(`${GOOGLE_ID}_20261105T080000Z`);
    expect(instanceId(GOOGLE_ID, "2026-11-05")).toBe(`${GOOGLE_ID}_20261105`);
  });
});

describe("colors", () => {
  it("each calendar color gets the closest of Google's colors", () => {
    expect(nearestColorId("#1d4ed8")).toBe("9"); // Dor's blue: Blueberry
    expect(nearestColorId("#be185d")).toBe("4"); // Maayan's pink: Flamingo
    expect(nearestColorId("#047857")).toBe("10"); // shared green: Basil
    expect(nearestColorId("#b91c1c")).toBe("11"); // red: Tomato
    for (const [id, color] of Object.entries(GOOGLE_EVENT_COLORS)) {
      expect(nearestColorId(color)).toBe(id);
    }
  });
});

describe("an event in Google", () => {
  it("a personal timed event: the owner's name first, local time with its zone", () => {
    expect(toGoogleEvent(dentist, context)).toEqual({
      id: GOOGLE_ID,
      status: "confirmed",
      summary: "דור: רופא שיניים",
      description: "",
      location: "תל אביב",
      colorId: "9",
      start: { dateTime: "2026-11-05T10:00:00+02:00", timeZone: "Asia/Jerusalem" },
      end: { dateTime: "2026-11-05T11:30:00+02:00", timeZone: "Asia/Jerusalem" },
      extendedProperties: {
        private: {
          ourCalendarEventId: ID,
          version: "3",
          owner: "dor",
          category: "personal",
        },
      },
    });
  });

  it("summer time gets its own offset", () => {
    const summer = {
      ...dentist,
      start: "2026-07-01T07:00:00.000Z",
      end: "2026-07-01T08:00:00.000Z",
    };
    expect(toGoogleEvent(summer, context).start).toEqual({
      dateTime: "2026-07-01T10:00:00+03:00",
      timeZone: "Asia/Jerusalem",
    });
  });

  it("a shared event keeps its title as is, with the shared color", () => {
    const dinner = { ...dentist, owner: "shared", title: "ארוחת ערב עם ההורים" };
    expect(toGoogleEvent(dinner, context)).toMatchObject({
      summary: "ארוחת ערב עם ההורים",
      colorId: "10",
      extendedProperties: { private: { owner: "shared" } },
    });
  });

  it("an all-day event has dates only, with the same exclusive end", () => {
    const trip = {
      ...dentist,
      owner: "maayan",
      title: "חופשה",
      isAllDay: true,
      start: "2026-11-05",
      end: "2026-11-08",
    };
    expect(toGoogleEvent(trip, context)).toMatchObject({
      summary: "מעיין: חופשה",
      start: { date: "2026-11-05" },
      end: { date: "2026-11-08" },
    });
  });

  it("a series is one repeating event with its rule", () => {
    const weekly = { ...dentist, rrule: "FREQ=WEEKLY;BYDAY=TH;WKST=SU;COUNT=4" };
    expect(toGoogleEvent(weekly, context).recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TH;WKST=SU;COUNT=4",
    ]);
    expect(toGoogleEvent(dentist, context)).not.toHaveProperty("recurrence");
  });

  it("an owner without a name or color is an error, not a wrong title", () => {
    expect(() => toGoogleEvent({ ...dentist, owner: "someone" }, context)).toThrow(/someone/);
  });
});

describe("a series' occurrences in Google", () => {
  // Every day at 10:00 local, from Thursday 5 November.
  const daily: ExportEvent = { ...dentist, rrule: "FREQ=DAILY" };
  const exception = (overrides: Partial<ExportException>): ExportException => ({
    originalStart: "2026-11-06T08:00:00.000Z",
    isCancelled: false,
    title: null,
    description: null,
    location: null,
    category: null,
    moved: null,
    ...overrides,
  });
  const updates = (event: ExportEvent, exported: string[] = []) =>
    instanceUpdates(event, context, exported);

  it("a one-off event, or a series without changes, needs nothing", () => {
    expect(updates(dentist)).toEqual({ updates: [], exported: [] });
    expect(updates(daily)).toEqual({ updates: [], exported: [] });
  });

  it("a series that became a one-off cancels the occurrences it had changed", () => {
    expect(updates(dentist, ["2026-11-06T08:00:00.000Z", "2026-11-07"])).toEqual({
      updates: [
        { kind: "cancel", instanceId: `${GOOGLE_ID}_20261106T080000Z` },
        { kind: "cancel", instanceId: `${GOOGLE_ID}_20261107` },
      ],
      exported: [],
    });
  });

  it("a changed occurrence keeps the series' other details", () => {
    const changed = {
      ...daily,
      exceptions: [exception({ title: "ביקורת", location: "", description: "להביא צילום" })],
    };
    expect(updates(changed)).toEqual({
      updates: [
        {
          kind: "change",
          instance: {
            ...toGoogleEvent(dentist, context),
            id: `${GOOGLE_ID}_20261106T080000Z`,
            summary: "דור: ביקורת",
            description: "להביא צילום",
            location: "",
            start: { dateTime: "2026-11-06T10:00:00+02:00", timeZone: "Asia/Jerusalem" },
            end: { dateTime: "2026-11-06T11:30:00+02:00", timeZone: "Asia/Jerusalem" },
            recurringEventId: GOOGLE_ID,
            originalStartTime: {
              dateTime: "2026-11-06T10:00:00+02:00",
              timeZone: "Asia/Jerusalem",
            },
          },
        },
      ],
      exported: ["2026-11-06T08:00:00.000Z"],
    });
  });

  it("a moved occurrence goes to its new times, even to a whole day", () => {
    const moved = {
      ...daily,
      exceptions: [
        exception({
          moved: {
            isAllDay: false,
            start: "2026-11-06T15:00:00.000Z",
            end: "2026-11-06T16:00:00.000Z",
          },
        }),
        exception({
          originalStart: "2026-11-07T08:00:00.000Z",
          moved: { isAllDay: true, start: "2026-11-07", end: "2026-11-08" },
        }),
      ],
    };
    const [first, second] = updates(moved).updates;
    expect(first).toMatchObject({
      instance: {
        start: { dateTime: "2026-11-06T17:00:00+02:00" },
        end: { dateTime: "2026-11-06T18:00:00+02:00" },
        originalStartTime: { dateTime: "2026-11-06T10:00:00+02:00" },
      },
    });
    expect(second).toMatchObject({
      instance: { start: { date: "2026-11-07" }, end: { date: "2026-11-08" } },
    });
  });

  it("a deleted occurrence is cancelled", () => {
    const cancelled = { ...daily, exceptions: [exception({ isCancelled: true })] };
    expect(updates(cancelled)).toEqual({
      updates: [{ kind: "cancel", instanceId: `${GOOGLE_ID}_20261106T080000Z` }],
      exported: ["2026-11-06T08:00:00.000Z"],
    });
  });

  it("an occurrence whose changes were dropped gets the series' values back", () => {
    expect(updates(daily, ["2026-11-06T08:00:00.000Z"])).toEqual({
      updates: [
        {
          kind: "change",
          instance: expect.objectContaining({
            id: `${GOOGLE_ID}_20261106T080000Z`,
            status: "confirmed",
            summary: "דור: רופא שיניים",
            start: { dateTime: "2026-11-06T10:00:00+02:00", timeZone: "Asia/Jerusalem" },
          }),
        },
      ],
      // Google keeps it as an occurrence of its own: later changes to the series set it too.
      exported: ["2026-11-06T08:00:00.000Z"],
    });
  });

  it("an occurrence the series no longer has is cancelled, in case Google kept it", () => {
    // The series moved to 11:00; the change made at 10:00 belongs to no occurrence now.
    const later = {
      ...daily,
      start: "2026-11-05T09:00:00.000Z",
      end: "2026-11-05T10:00:00.000Z",
      exceptions: [exception({ title: "ביקורת" })],
    };
    expect(updates(later, ["2026-11-06T08:00:00.000Z"])).toEqual({
      updates: [{ kind: "cancel", instanceId: `${GOOGLE_ID}_20261106T080000Z` }],
      exported: [],
    });
  });

  it("an all-day series: occurrences by date", () => {
    const yearly: ExportEvent = {
      ...dentist,
      owner: "shared",
      title: "יום נישואין",
      isAllDay: true,
      start: "2026-11-05",
      end: "2026-11-06",
      rrule: "FREQ=YEARLY",
      exceptions: [exception({ originalStart: "2027-11-05", title: "יום נישואין בחו״ל" })],
    };
    expect(updates(yearly)).toEqual({
      updates: [
        {
          kind: "change",
          instance: expect.objectContaining({
            id: `${GOOGLE_ID}_20271105`,
            summary: "יום נישואין בחו״ל",
            start: { date: "2027-11-05", timeZone: "Asia/Jerusalem" },
            end: { date: "2027-11-06", timeZone: "Asia/Jerusalem" },
            originalStartTime: { date: "2027-11-05", timeZone: "Asia/Jerusalem" },
          }),
        },
      ],
      exported: ["2027-11-05"],
    });
  });
});
