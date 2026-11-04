"use client";

import { Skeleton } from "@chakra-ui/react";
import dynamic from "next/dynamic";

// The calendar renders in the browser only. Its dates depend on "now", and a server
// render can land on a different day than the browser (around midnight, or a clock
// difference), which would make hydration fail.
export const CalendarView = dynamic(
  () => import("./full-calendar").then((module) => module.Calendar),
  { ssr: false, loading: () => <Skeleton h="xl" data-testid="calendar-loading" /> },
);
