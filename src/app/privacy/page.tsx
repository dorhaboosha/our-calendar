import { Box, Heading, Link, Stack, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { getTranslations } from "next-intl/server";

const SECTIONS = [
  "collect",
  "use",
  "google",
  "limitedUse",
  "storage",
  "delete",
  "contact",
] as const;
const REPO_URL = "https://github.com/dorhaboosha/our-calendar";

// Public page (no sign-in): Google requires a privacy policy link to publish the OAuth app.
export default async function PrivacyPage() {
  const t = await getTranslations("privacy");

  return (
    <Box as="main" px={{ base: "4", md: "6" }} py="8" maxW="3xl" mx="auto">
      <Stack gap="6">
        <Stack gap="1">
          <Heading as="h1" size="2xl">
            {t("title")}
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            {t("updated")}
          </Text>
        </Stack>
        <Text>{t("intro")}</Text>
        {SECTIONS.map((key) => (
          <Stack
            as="section"
            key={key}
            gap="2"
            // The Limited Use statement is in English, so it reads left to right.
            dir={key === "limitedUse" ? "ltr" : undefined}
          >
            <Heading as="h2" size="md">
              {t(`sections.${key}.heading`)}
            </Heading>
            <Text>
              {t.rich(`sections.${key}.body`, {
                link: (chunks) => (
                  <Link href={REPO_URL} colorPalette="blue" dir="ltr">
                    {chunks}
                  </Link>
                ),
              })}
            </Text>
          </Stack>
        ))}
        <Link asChild colorPalette="blue" w="fit-content">
          <NextLink href="/login">{t("back")}</NextLink>
        </Link>
      </Stack>
    </Box>
  );
}
