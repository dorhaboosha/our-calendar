"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "./calendar.css";

import { Box, Text } from "@chakra-ui/react";
import FullCalendar, {
  type EventDisplayInfo,
  type EventInput,
  type EventSourceFuncInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { useCallback, useState } from "react";
import { appConfig } from "@/config/app.config";
import type { CalendarEvent } from "@/modules/events/events";
import { textColorFor } from "@/modules/users/colors";
import { fullCalendarLocale } from "./locales";

export type CalendarProps = {
  /** Event color per owner: each user key, plus "shared". */
  ownerColors: Record<string, string>;
  /** Hebrew category label per category key. */
  categoryLabels: Record<string, string>;
  loadErrorText: string;
};

const TIME_FORMAT = { hour: "2-digit", minute: "2-digit", hour12: false } as const;

export function Calendar({ ownerColors, categoryLabels, loadErrorText }: CalendarProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [isTimeGrid, setIsTimeGrid] = useState(false);

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
          color,
          contrastColor: textColorFor(color),
          extendedProps: { category: event.category, owner: event.owner },
        };
      });
    },
    [ownerColors],
  );

  // Time, title, and the category as text, so meaning never depends on color alone.
  const renderEvent = useCallback(
    (arg: EventDisplayInfo) => {
      const category = categoryLabels[arg.event.extendedProps.category as string];
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
    // FullCalendar keeps a hidden measuring element far to the left (left: -9909px). In
    // a right-to-left page that overflows into a huge horizontal scroll, so the calendar
    // clips it. "clip", unlike "hidden", keeps the sticky headers working.
    <Box data-testid="calendar" position="relative" overflowX="clip">
      {loadFailed && (
        <Text role="alert" color="fg.error" mb="3">
          {loadErrorText}
        </Text>
      )}
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, classicThemePlugin]}
        locale={fullCalendarLocale(appConfig.locale)}
        direction={appConfig.direction}
        timeZone={appConfig.timeZone}
        initialView="dayGridMonth"
        headerToolbar={{
          start: "prev,next today",
          center: "title",
          end: "dayGridMonth,timeGridWeek,timeGridDay",
        }}
        events={fetchEvents}
        eventSourceFailure={() => setLoadFailed(true)}
        eventContent={renderEvent}
        eventTimeFormat={TIME_FORMAT}
        slotHeaderFormat={TIME_FORMAT}
        dayMaxEvents
        // Timed events in the month view as colored blocks, like all-day events, not dots.
        eventDisplay="block"
        nowIndicator
        scrollTime="08:00:00"
        // Month view grows with its content; day and week views scroll inside a fixed height.
        height={isTimeGrid ? "75vh" : "auto"}
        datesSet={(info) => setIsTimeGrid(info.view.type.startsWith("timeGrid"))}
      />
    </Box>
  );
}
