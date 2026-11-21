import { Button, Stack, Text } from "@chakra-ui/react";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/modules/auth/current-user";
import {
  CONNECT_RESULTS,
  type ConnectResult,
  getExportStatus,
} from "@/modules/google-export/connection";

const CONNECT_URL = "/api/integrations/google/connect";

/**
 * The signed-in user's export to Google Calendar: its state, and connecting it. result
 * is how connecting just ended (?google=... after Google sent the browser back).
 */
export async function GoogleExport({ result }: { result: Promise<string | undefined> }) {
  const user = await requireUser();
  const [t, format, status, resultParam] = await Promise.all([
    getTranslations("settings.googleExport"),
    getFormatter(),
    getExportStatus(user.id),
    result,
  ]);
  const connectResult = CONNECT_RESULTS.find((each) => each === resultParam) as
    ConnectResult | undefined;

  return (
    <Stack gap="4" align="start">
      {connectResult && (
        <Text
          role={connectResult === "connected" ? "status" : "alert"}
          color={connectResult === "connected" ? "fg.success" : "fg.error"}
        >
          {t(`results.${connectResult}`)}
        </Text>
      )}
      <Stack gap="1">
        <Text fontWeight="medium">{t(`states.${status.state}`)}</Text>
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
      {(status.state === "notConnected" || status.state === "needsReauth") && (
        // A plain link, not a client-side navigation: it leaves the app for Google.
        <Button asChild>
          <a href={CONNECT_URL}>{t(status.state === "notConnected" ? "connect" : "reconnect")}</a>
        </Button>
      )}
    </Stack>
  );
}
