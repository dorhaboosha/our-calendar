import { Box, Heading, Skeleton, Stack, Text } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { appConfig } from "@/config/app.config";
import { requireUser } from "@/modules/auth/current-user";
import { otherCalendarColors } from "@/modules/users/users";
import { ColorForm } from "./color-form";

// The page itself reads no data, so it renders at once on navigation; the form
// streams in behind its own Suspense boundary.
export default function SettingsPage() {
  const t = useTranslations("settings");

  return (
    <Box as="main" px={{ base: "4", md: "6" }} py="6" maxW="2xl" mx="auto">
      <Stack gap="6">
        <Heading size="2xl">{t("title")}</Heading>
        <Stack gap="4" borderWidth="1px" borderRadius="lg" p={{ base: "4", md: "6" }}>
          <Stack gap="1">
            <Heading as="h2" size="lg">
              {t("colorTitle")}
            </Heading>
            <Text color="fg.muted">{t("colorHelp")}</Text>
          </Stack>
          <Suspense fallback={<Skeleton h="64" />}>
            <MyColorForm />
          </Suspense>
        </Stack>
      </Stack>
    </Box>
  );
}

async function MyColorForm() {
  const user = await requireUser();
  const t = await getTranslations();
  const others = await otherCalendarColors(user.configKey, t("common.shared"));

  return (
    <ColorForm
      displayName={user.displayName}
      currentColor={user.color}
      palette={[...appConfig.colorPalette]}
      others={others}
    />
  );
}
