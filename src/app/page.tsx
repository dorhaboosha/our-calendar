import { Box, HStack, Heading, Stack, Text } from "@chakra-ui/react";
import { getTranslations } from "next-intl/server";
import { appConfig } from "@/config/app.config";

export default async function HomePage() {
  const t = await getTranslations();
  const legend = [
    ...appConfig.users.map((user) => ({ label: user.displayName, color: user.defaultColor })),
    { label: t("common.shared"), color: appConfig.sharedColor },
  ];

  return (
    <Box as="main" px={{ base: "4", md: "6" }} py="6" maxW="6xl" mx="auto">
      <Stack gap="6">
        <Heading size="2xl">{t("home.title")}</Heading>
        <Box borderWidth="1px" borderRadius="lg" p="8" textAlign="center">
          <Text color="fg.muted">{t("home.placeholder")}</Text>
        </Box>
        <Stack gap="2">
          <Heading size="sm">{t("home.legend")}</Heading>
          <HStack gap="2" wrap="wrap">
            {legend.map((item) => (
              <Box
                key={item.label}
                bg={item.color}
                color="white"
                px="3"
                py="1"
                borderRadius="md"
                fontSize="sm"
              >
                {item.label}
              </Box>
            ))}
          </HStack>
        </Stack>
      </Stack>
    </Box>
  );
}
