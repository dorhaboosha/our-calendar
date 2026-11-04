"use client";

import { Alert, Button, Dialog, Portal, Text } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { deleteEventAction } from "@/app/(app)/event-actions";
import type { CalendarEvent } from "@/modules/events/events";

type Props = {
  event: CalendarEvent;
  /** "Cancel": back to the event's details. */
  onCancel: () => void;
  onDeleted: () => void;
  /** The event was changed or deleted meanwhile; the calendar should reload it. */
  onStale: () => void;
};

/** Asks before deleting. Focus starts on "cancel", so Enter alone never deletes. */
export function DeleteEventDialog({ event, onCancel, onDeleted, onStale }: Props) {
  const t = useTranslations();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await deleteEventAction(event.id, event.version);
      if (result.ok) {
        onDeleted();
        return;
      }
      setError(result.message);
      onStale();
    } catch {
      setError(t("deleteEvent.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root
      open
      role="alertdialog"
      onOpenChange={(details) => !details.open && onCancel()}
      initialFocusEl={() => cancelRef.current}
      size="sm"
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{t("deleteEvent.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body display="flex" flexDirection="column" gap="4">
              <Text overflowWrap="anywhere">{t("deleteEvent.body", { title: event.title })}</Text>
              {error && (
                <Alert.Root status="error">
                  <Alert.Indicator />
                  <Alert.Title>{error}</Alert.Title>
                </Alert.Root>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={pending}>
                {t("deleteEvent.cancel")}
              </Button>
              <Button
                colorPalette="red"
                onClick={confirm}
                loading={pending}
                loadingText={t("deleteEvent.deleting")}
              >
                {t("deleteEvent.confirm")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
