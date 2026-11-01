import { Box, Heading, Skeleton, Stack } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CalendarView } from "@/components/calendar/calendar-view";
import { appConfig } from "@/config/app.config";
import { requireUser } from "@/modules/auth/current-user";
import { SHARED_OWNER } from "@/modules/events/validation";
import { getSharedColor, listCalendarUsers } from "@/modules/users/users";

// The page itself reads no data, so it renders at once on navigation; data parts
// stream in behind their own Suspense boundaries.
export default function HomePage() {
  const t = useTranslations();

  return (
    <Box as="main" px={{ base: "4", md: "6" }} py="6" maxW="6xl" mx="auto">
      <Stack gap="6">
        <Heading size="2xl" srOnly>
          {t("home.title")}
        </Heading>
        {/* The owner filter chips above the calendar double as its color legend. */}
        <Suspense fallback={<Skeleton h="xl" />}>
          <Calendar />
        </Suspense>
      </Stack>
    </Box>
  );
}

/** The calendar, with each owner's current color and the category labels. */
async function Calendar() {
  const t = await getTranslations();
  const user = await requireUser();
  const [users, sharedColor] = await Promise.all([listCalendarUsers(), getSharedColor()]);
  const ownerColors: Record<string, string> = {
    ...Object.fromEntries(users.map((user) => [user.configKey, user.color])),
    [SHARED_OWNER]: sharedColor,
  };
  const categoryLabels = Object.fromEntries(
    appConfig.categories.map((category) => [category.key, t(`categories.${category.key}`)]),
  );
  return (
    <CalendarView
      ownerColors={ownerColors}
      categoryLabels={categoryLabels}
      loadErrorText={t("home.loadError")}
      goToDateLabel={t("home.goToDate")}
      newEventLabel={t("eventForm.newEvent")}
      currentUserKey={user.configKey}
    />
  );
}
