import { Box, Heading, Skeleton, Stack, Text } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { appConfig } from "@/config/app.config";
import { requireUser } from "@/modules/auth/current-user";
import { getSharedColor, otherCalendarColors, userCalendarColors } from "@/modules/users/users";
import { saveMyColor, saveSharedColor } from "./actions";
import { ColorForm } from "./color-form";

// The page itself reads no data, so it renders at once on navigation; each form
// streams in behind its own Suspense boundary.
export default function SettingsPage() {
  const t = useTranslations("settings");

  return (
    <Box as="main" px={{ base: "4", md: "6" }} py="6" maxW="2xl" mx="auto">
      <Stack gap="6">
        <Heading size="2xl">{t("title")}</Heading>
        <SettingsSection id="my-color" title={t("colorTitle")} help={t("colorHelp")}>
          <MyColorForm />
        </SettingsSection>
        <SettingsSection
          id="shared-color"
          title={t("sharedColorTitle")}
          help={t("sharedColorHelp")}
        >
          <SharedColorForm />
        </SettingsSection>
      </Stack>
    </Box>
  );
}

/** A titled box; the title names the section for screen readers (role "region"). */
function SettingsSection({
  id,
  title,
  help,
  children,
}: {
  id: string;
  title: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <Stack
      as="section"
      aria-labelledby={id}
      gap="4"
      borderWidth="1px"
      borderRadius="lg"
      p={{ base: "4", md: "6" }}
    >
      <Stack gap="1">
        <Heading as="h2" size="lg" id={id}>
          {title}
        </Heading>
        <Text color="fg.muted">{help}</Text>
      </Stack>
      <Suspense fallback={<Skeleton h="64" />}>{children}</Suspense>
    </Stack>
  );
}

async function MyColorForm() {
  const user = await requireUser();
  const t = await getTranslations();
  const others = await otherCalendarColors(user.configKey, t("common.shared"));

  return (
    <ColorForm
      previewName={user.displayName}
      currentColor={user.color}
      palette={[...appConfig.colorPalette]}
      others={others}
      save={saveMyColor}
    />
  );
}

async function SharedColorForm() {
  await requireUser();
  const t = await getTranslations();
  const [sharedColor, others] = await Promise.all([getSharedColor(), userCalendarColors()]);

  return (
    <ColorForm
      previewName={t("common.shared")}
      currentColor={sharedColor}
      palette={[...appConfig.colorPalette]}
      others={others}
      save={saveSharedColor}
    />
  );
}
