import { Box, HStack, Heading, Skeleton, Stack } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CalendarView } from "@/components/calendar/calendar-view";
import { appConfig } from "@/config/app.config";
import { textColorFor } from "@/modules/users/colors";
import { SHARED_OWNER } from "@/modules/events/validation";
import { listCalendarUsers } from "@/modules/users/users";

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
        <Suspense fallback={<Skeleton h="xl" />}>
          <Calendar />
        </Suspense>
        <Stack gap="2">
          <Heading size="sm">{t("home.legend")}</Heading>
          <Suspense fallback={<Skeleton h="7" w="48" />}>
            <ColorLegend />
          </Suspense>
        </Stack>
      </Stack>
    </Box>
  );
}

/** The calendar, with each owner's current color and the category labels. */
async function Calendar() {
  const t = await getTranslations();
  const users = await listCalendarUsers();
  const ownerColors: Record<string, string> = {
    ...Object.fromEntries(users.map((user) => [user.configKey, user.color])),
    [SHARED_OWNER]: appConfig.sharedColor,
  };
  const categoryLabels = Object.fromEntries(
    appConfig.categories.map((category) => [category.key, t(`categories.${category.key}`)]),
  );
  return (
    <CalendarView
      ownerColors={ownerColors}
      categoryLabels={categoryLabels}
      loadErrorText={t("home.loadError")}
    />
  );
}

async function ColorLegend() {
  const t = await getTranslations();
  const users = await listCalendarUsers();
  const legend = [
    ...users.map((user) => ({ label: user.displayName, color: user.color })),
    { label: t("common.shared"), color: appConfig.sharedColor },
  ];

  return (
    <HStack gap="2" wrap="wrap">
      {legend.map((item) => (
        <Box
          key={item.label}
          bg={item.color}
          color={textColorFor(item.color)}
          px="3"
          py="1"
          borderRadius="md"
          fontSize="sm"
        >
          {item.label}
        </Box>
      ))}
    </HStack>
  );
}
