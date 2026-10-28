import { Box, HStack, Heading, Skeleton, Stack, Text } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { appConfig } from "@/config/app.config";
import { textColorFor } from "@/modules/users/colors";
import { listCalendarUsers } from "@/modules/users/users";

// The page itself reads no data, so it renders at once on navigation; data parts
// stream in behind their own Suspense boundaries.
export default function HomePage() {
  const t = useTranslations();

  return (
    <Box as="main" px={{ base: "4", md: "6" }} py="6" maxW="6xl" mx="auto">
      <Stack gap="6">
        <Heading size="2xl">{t("home.title")}</Heading>
        <Box borderWidth="1px" borderRadius="lg" p="8" textAlign="center">
          <Text color="fg.muted">{t("home.placeholder")}</Text>
        </Box>
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
