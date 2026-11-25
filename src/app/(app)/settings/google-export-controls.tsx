"use client";

import { Button, HStack, RadioGroup, Stack, Text } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ExportState } from "@/modules/google-export/connection";
import { type GoogleActionResult, disconnectGoogle, exportToGoogleAgain } from "./actions";

const CONNECT_URL = "/api/integrations/google/connect";

type Props = {
  state: ExportState;
  canDeleteCalendar: boolean;
  /** How connecting just ended, if the user just came back from Google. */
  connectResult: GoogleActionResult | null;
};

/**
 * What the user can do with their export: connect, export again (or create the calendar
 * again), and disconnect, choosing whether to delete the calendar in Google.
 */
export function GoogleExportControls({ state, canDeleteCalendar, connectResult }: Props) {
  const t = useTranslations("settings.googleExport");
  const [result, setResult] = useState<GoogleActionResult | null>(connectResult);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"exportAgain" | "disconnect" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [calendar, setCalendar] = useState<"keep" | "delete">("keep");
  const panel = useRef<HTMLDivElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  // The result of connecting is shown once: reloading the page doesn't show it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("google")) return;
    url.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  // Focus follows the disconnect panel: into it when it opens, back when it closes.
  useEffect(() => {
    if (confirming) panel.current?.focus();
    else if (opened.current) disconnectButton.current?.focus();
    opened.current = confirming;
  }, [confirming]);

  const run = (kind: "exportAgain" | "disconnect", action: () => Promise<GoogleActionResult>) => {
    setRunning(kind);
    setResult(null);
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) setConfirming(false);
    });
  };

  const connected = state !== "notConnected";
  const busy = (kind: "exportAgain" | "disconnect") => pending && running === kind;

  return (
    <Stack gap="4" align="start" w="full">
      <HStack gap="3" wrap="wrap">
        {(state === "notConnected" || state === "needsReauth") && (
          // A plain link, not a client-side navigation: it leaves the app for Google.
          <Button asChild>
            <a href={CONNECT_URL}>{t(state === "notConnected" ? "connect" : "reconnect")}</a>
          </Button>
        )}
        {(state === "exporting" ||
          state === "someFailed" ||
          state === "upToDate" ||
          state === "needsAction") && (
          <Button
            variant={state === "needsAction" ? "solid" : "outline"}
            onClick={() => run("exportAgain", exportToGoogleAgain)}
            loading={busy("exportAgain")}
            disabled={pending}
          >
            {t(state === "needsAction" ? "recreate" : "exportAgain")}
          </Button>
        )}
        {connected && !confirming && (
          <Button
            ref={disconnectButton}
            variant="outline"
            colorPalette="red"
            onClick={() => {
              setCalendar("keep");
              setResult(null);
              setConfirming(true);
            }}
            disabled={pending}
          >
            {t("disconnect")}
          </Button>
        )}
      </HStack>

      {connected && confirming && (
        <Stack
          ref={panel}
          tabIndex={-1}
          role="group"
          aria-labelledby="google-disconnect-title"
          gap="4"
          borderWidth="1px"
          borderRadius="md"
          p="4"
          w="full"
        >
          <Text id="google-disconnect-title" fontWeight="medium">
            {t("disconnectTitle")}
          </Text>
          {canDeleteCalendar ? (
            <RadioGroup.Root
              value={calendar}
              onValueChange={(details) =>
                details.value && setCalendar(details.value as "keep" | "delete")
              }
            >
              <RadioGroup.Label>{t("calendarChoice")}</RadioGroup.Label>
              <Stack gap="3" mt="3">
                {(["keep", "delete"] as const).map((choice) => (
                  <RadioGroup.Item key={choice} value={choice}>
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>
                      {t(choice === "keep" ? "keepCalendar" : "deleteCalendar")}
                    </RadioGroup.ItemText>
                  </RadioGroup.Item>
                ))}
              </Stack>
            </RadioGroup.Root>
          ) : (
            state !== "needsAction" && <Text>{t("calendarKept")}</Text>
          )}
          <Text color="fg.muted" fontSize="sm">
            {t("disconnectNote")}
          </Text>
          <HStack gap="3" wrap="wrap">
            <Button
              colorPalette="red"
              onClick={() =>
                run("disconnect", () =>
                  disconnectGoogle(canDeleteCalendar && calendar === "delete"),
                )
              }
              loading={busy("disconnect")}
            >
              {t("confirmDisconnect")}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              {t("cancel")}
            </Button>
          </HStack>
        </Stack>
      )}

      {result && (
        <Text role={result.ok ? "status" : "alert"} color={result.ok ? "fg.success" : "fg.error"}>
          {result.message}
        </Text>
      )}
    </Stack>
  );
}
