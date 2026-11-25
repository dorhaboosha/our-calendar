import { Stack, Text } from "@chakra-ui/react";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/modules/auth/current-user";
import { CONNECT_RESULTS, getExportStatus } from "@/modules/google-export/connection";
import { GoogleExportControls } from "./google-export-controls";

/**
 * The signed-in user's export to Google Calendar: its state, and what they can do with
 * it. result is how connecting just ended (?google=... after Google sent them back).
 */
export async function GoogleExport({ result }: { result: Promise<string | undefined> }) {
  const user = await requireUser();
  const [t, format, status, resultParam] = await Promise.all([
    getTranslations("settings.googleExport"),
    getFormatter(),
    getExportStatus(user.id),
    result,
  ]);
  const connectResult = CONNECT_RESULTS.find((each) => each === resultParam);

  return (
    <Stack gap="4" align="start">
      <Stack gap="1">
        <Text fontWeight="medium">{t(`states.${status.state}`)}</Text>
        {status.setupFailed && (
          <Text color="fg.error">{t(`setupFailed.${status.setupFailed}`)}</Text>
        )}
        {status.failed > 0 && <Text color="fg.error">{t("failed", { count: status.failed })}</Text>}
        {status.lastSuccessfulExportAt && status.state !== "notConnected" && (
          <Text color="fg.muted" fontSize="sm">
            {t("lastExport", {
              time: format.dateTime(status.lastSuccessfulExportAt, {
                dateStyle: "short",
                timeStyle: "short",
              }),
            })}
          </Text>
        )}
      </Stack>
      <GoogleExportControls
        state={status.state}
        canDeleteCalendar={status.canDeleteCalendar}
        connectResult={
          connectResult
            ? { ok: connectResult === "connected", message: t(`results.${connectResult}`) }
            : null
        }
      />
    </Stack>
  );
}
