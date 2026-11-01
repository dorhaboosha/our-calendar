"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "./calendar.css";

import { Box, Button, Field, HStack, Input, Text } from "@chakra-ui/react";
import FullCalendar, {
  type CalendarRef,
  type DateClickInfo,
  type DatesSetInfo,
  type DayCellInfo,
  type DayLaneInfo,
  type EventClickInfo,
  type EventDisplayInfo,
  type EventInput,
  type EventSourceFuncInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { appConfig } from "@/config/app.config";
import { DeleteEventDialog } from "@/components/events/delete-event-dialog";
import { EventDetailsDialog } from "@/components/events/event-details-dialog";
import { EventFormDialog } from "@/components/events/event-form-dialog";
import type { CalendarEvent } from "@/modules/events/events";
import {
  type EventFormValues,
  type NewEventClick,
  eventFormValues,
  newEventValues,
} from "@/modules/events/form";
import { isLocalDate, toLocal } from "@/modules/events/time";
import { SHARED_OWNER } from "@/modules/events/validation";
import { textColorFor } from "@/modules/users/colors";
import { CalendarFilterChips } from "./calendar-filters";
import { type CalendarFilters, isVisible, readFilters, writeFilters } from "./filters";
import { fullCalendarLocale } from "./locales";
import {
  CALENDAR_VIEWS,
  PHONE_MAX_WIDTH,
  readCalendarPlace,
  viewNameOf,
  writeCalendarPlace,
} from "./url-state";

export type CalendarProps = {
  /** Event color per owner: each user key, plus "shared". */
  ownerColors: Record<string, string>;
  /** Hebrew category label per category key. */
  categoryLabels: Record<string, string>;
  loadErrorText: string;
  goToDateLabel: string;
  newEventLabel: string;
  /** The signed-in user: the default owner of a new event. */
  currentUserKey: string;
};

const TIME_FORMAT = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
// Timed events in the month view as colored blocks, like all-day events, not dots.
const EVENT_DISPLAY = "block";
const OWNER_KEYS = [...appConfig.users.map((user) => user.key), SHARED_OWNER];

/** A filtered-out event stays loaded, with display "none". */
function displayFor(event: CalendarEvent, filters: CalendarFilters) {
  return isVisible(event, filters) ? EVENT_DISPLAY : "none";
}

/** The window open over the calendar, if any. */
type Panel =
  | { kind: "create"; values: EventFormValues }
  | { kind: "details"; event: CalendarEvent }
  | { kind: "edit"; event: CalendarEvent }
  | { kind: "delete"; event: CalendarEvent };

export function Calendar({
  ownerColors,
  categoryLabels,
  loadErrorText,
  goToDateLabel,
  newEventLabel,
  currentUserKey,
}: CalendarProps) {
  const t = useTranslations();
  const calendarRef = useRef<CalendarRef>(null);
  // Where to open: the URL's view and date, or the defaults. This component renders in
  // the browser only, so reading window here is safe.
  const [initial] = useState(() =>
    readCalendarPlace(
      window.location.search,
      window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches,
    ),
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [isTimeGrid, setIsTimeGrid] = useState(initial.view !== "month");
  const [currentDate, setCurrentDate] = useState(
    initial.date ?? toLocal(new Date(), appConfig.timeZone).date,
  );
  // The date chosen in the date picker, outlined in the month and week views so it is
  // clear where the calendar jumped to. Cleared by any other navigation.
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  // After every navigation: remember the view and date in the URL (replacing the current
  // history entry, so Back still leaves the calendar) and update the date picker.
  const onDatesSet = useCallback((info: DatesSetInfo) => {
    const view = viewNameOf(info.view.type);
    setIsTimeGrid(info.view.type.startsWith("timeGrid"));
    if (!view) return;
    // getDate() is a real instant; its local date is the calendar's current day.
    const date = toLocal(info.view.calendar.getDate(), appConfig.timeZone).date;
    setCurrentDate(date);
    // Switching views keeps the picked date; the arrows and "today" move away from it.
    setPickedDate((picked) => (picked === date ? picked : null));
    const today = toLocal(new Date(), appConfig.timeZone).date;
    const search = writeCalendarPlace(window.location.search, {
      view,
      date: date === today ? null : date,
    });
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}`);
  }, []);

  // Which owners and categories are shown; kept in the URL like the view and date.
  const [filters, setFilters] = useState(() =>
    readFilters(window.location.search, OWNER_KEYS, Object.keys(categoryLabels)),
  );
  // The latest filters, for events loaded later (another month, or after a save).
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
    // Hide or show the loaded events at once, without loading them again.
    for (const event of calendarRef.current?.getApi().getEvents() ?? []) {
      event.setProp("display", displayFor(event.extendedProps.event as CalendarEvent, filters));
    }
    const search = writeFilters(window.location.search, filters);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}`);
  }, [filters]);

  const [panel, setPanel] = useState<Panel | null>(null);
  const closePanel = () => setPanel(null);
  const refetchEvents = () => calendarRef.current?.getApi().refetchEvents();

  function openNewEvent(click?: NewEventClick) {
    const now = new Date();
    setPanel({
      kind: "create",
      values: newEventValues({
        owner: currentUserKey,
        category: appConfig.defaultCategory,
        now,
        timeZone: appConfig.timeZone,
        today: toLocal(now, appConfig.timeZone).date,
        click,
      }),
    });
  }

  // A click (or Enter) on an event opens its details. The event is as last loaded; if
  // it changed since, saving or deleting is refused and the calendar reloads it.
  function onEventClick(info: EventClickInfo) {
    setPanel({ kind: "details", event: info.event.extendedProps.event as CalendarEvent });
  }

  const colorOf = (event: CalendarEvent) => ownerColors[event.owner] ?? appConfig.sharedColor;

  // A click on an empty spot: a day in the month view, a time slot or the "all day" row
  // in the week and day views.
  function onDateClick(info: DateClickInfo) {
    const local = toLocal(info.date, appConfig.timeZone);
    if (info.view.type === CALENDAR_VIEWS.month) openNewEvent({ kind: "day", date: local.date });
    else if (info.allDay) openNewEvent({ kind: "allDay", date: local.date });
    else openNewEvent({ kind: "time", date: local.date, time: local.time });
  }

  function goToDate(value: string) {
    setCurrentDate(value);
    // An incomplete date while typing is ignored until it is a real date.
    if (!isLocalDate(value)) return;
    setPickedDate(value);
    calendarRef.current?.getApi().gotoDate(value);
  }

  // Day cells (month view) and day columns (week view) get a class for the picked date.
  const pickedDateClass = useCallback(
    (info: DayCellInfo | DayLaneInfo) =>
      pickedDate &&
      info.view.type !== CALENDAR_VIEWS.day &&
      toLocal(info.date, appConfig.timeZone).date === pickedDate
        ? "picked-date"
        : "",
    [pickedDate],
  );

  // Loads the events of the dates on screen; FullCalendar calls it on every navigation.
  const fetchEvents = useCallback(
    async (info: EventSourceFuncInfo): Promise<EventInput[]> => {
      const query = new URLSearchParams({
        start: info.start.toISOString(),
        end: info.end.toISOString(),
      });
      const response = await fetch(`/api/events?${query}`, { cache: "no-store" });
      if (response.status === 401) {
        // The session ended (expired, or signed out in another tab).
        window.location.replace("/login");
        return [];
      }
      if (!response.ok) throw new Error(`GET /api/events: ${response.status}`);
      const { events } = (await response.json()) as { events: CalendarEvent[] };
      setLoadFailed(false);
      return events.map((event) => {
        const color = ownerColors[event.owner] ?? appConfig.sharedColor;
        return {
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.isAllDay,
          display: displayFor(event, filtersRef.current),
          color,
          contrastColor: textColorFor(color),
          extendedProps: { event },
        };
      });
    },
    [ownerColors],
  );

  // Time, title, and the category as text, so meaning never depends on color alone.
  const renderEvent = useCallback(
    (arg: EventDisplayInfo) => {
      const category = categoryLabels[(arg.event.extendedProps.event as CalendarEvent).category];
      return (
        <Box px="1" overflow="hidden" whiteSpace="nowrap" textOverflow="ellipsis" fontSize="xs">
          {arg.timeText && (
            // bdi keeps "10:00" left to right inside the Hebrew text; the space separates it.
            <Text as="bdi" fontWeight="bold">
              {arg.timeText}
            </Text>
          )}
          {arg.timeText && " "}
          <Text as="span" fontWeight="medium">
            {arg.event.title}
          </Text>
          {category && <Text as="span">{` · ${category}`}</Text>}
        </Box>
      );
    },
    [categoryLabels],
  );

  return (
    <Box>
      <HStack mb="3" gap="3" align="end" wrap="wrap">
        <Button onClick={() => openNewEvent()}>{newEventLabel}</Button>
        <Field.Root maxW="xs">
          <Field.Label>{goToDateLabel}</Field.Label>
          <Input
            type="date"
            size="sm"
            value={currentDate}
            onChange={(event) => goToDate(event.target.value)}
          />
        </Field.Root>
      </HStack>
      <CalendarFilterChips
        owners={[
          ...appConfig.users.map((user) => ({ key: user.key, label: user.displayName })),
          { key: SHARED_OWNER, label: t("common.shared") },
        ]}
        ownerColors={ownerColors}
        categories={Object.entries(categoryLabels).map(([key, label]) => ({ key, label }))}
        filters={filters}
        onChange={setFilters}
      />
      {panel?.kind === "create" && (
        <EventFormDialog
          initialValues={panel.values}
          onClose={closePanel}
          onSaved={refetchEvents}
          onStale={refetchEvents}
        />
      )}
      {panel?.kind === "details" && (
        <EventDetailsDialog
          event={panel.event}
          color={colorOf(panel.event)}
          onEdit={() => setPanel({ kind: "edit", event: panel.event })}
          onDelete={() => setPanel({ kind: "delete", event: panel.event })}
          onClose={closePanel}
        />
      )}
      {panel?.kind === "edit" && (
        <EventFormDialog
          initialValues={eventFormValues(panel.event, appConfig.timeZone)}
          editing={{ id: panel.event.id, version: panel.event.version }}
          onClose={closePanel}
          onSaved={refetchEvents}
          onStale={refetchEvents}
        />
      )}
      {panel?.kind === "delete" && (
        <DeleteEventDialog
          event={panel.event}
          onCancel={() => setPanel({ kind: "details", event: panel.event })}
          onDeleted={() => {
            closePanel();
            refetchEvents();
          }}
          onStale={refetchEvents}
        />
      )}
      {loadFailed && (
        <Text role="alert" color="fg.error" mb="3">
          {loadErrorText}
        </Text>
      )}
      {/* FullCalendar keeps a hidden measuring element far to the left (left: -9909px).
          In a right-to-left page that overflows into a huge horizontal scroll, so the
          calendar clips it. "clip", unlike "hidden", keeps the sticky headers working. */}
      <Box data-testid="calendar" position="relative" overflowX="clip">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, classicThemePlugin]}
          dateClick={onDateClick}
          eventClick={onEventClick}
          locale={fullCalendarLocale(appConfig.locale)}
          direction={appConfig.direction}
          timeZone={appConfig.timeZone}
          initialView={CALENDAR_VIEWS[initial.view]}
          initialDate={initial.date ?? undefined}
          headerToolbar={{
            start: "prev,next today",
            center: "title",
            end: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          events={fetchEvents}
          eventSourceFailure={() => setLoadFailed(true)}
          eventContent={renderEvent}
          dayCellClass={pickedDateClass}
          dayLaneClass={pickedDateClass}
          eventTimeFormat={TIME_FORMAT}
          slotHeaderFormat={TIME_FORMAT}
          dayMaxEvents
          eventDisplay={EVENT_DISPLAY}
          nowIndicator
          scrollTime="08:00:00"
          // Month view grows with its content; day and week views scroll inside a fixed height.
          height={isTimeGrid ? "75vh" : "auto"}
          datesSet={onDatesSet}
        />
      </Box>
    </Box>
  );
}
