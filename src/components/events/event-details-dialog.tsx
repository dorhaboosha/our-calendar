"use client";

import {
  Box,
  Button,
  CloseButton,
  DataList,
  Dialog,
  HStack,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { appConfig, getUserConfig } from "@/config/app.config";
import { describeWhen } from "@/modules/events/display";
import type { CalendarEvent } from "@/modules/events/events";
import { SHARED_OWNER } from "@/modules/events/validation";
import { dialogFromMdUp } from "./dialog-styles";

type Props = {
  event: CalendarEvent;
  /** The event's color in the calendar (its owner's). */
  color: string;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
};

/** What clicking an event opens: its details, with "edit" and "delete". */
export function EventDetailsDialog({ event, color, onEdit, onDelete, onClose }: Props) {
  const t = useTranslations();
  const when = describeWhen(event, appConfig.timeZone, appConfig.intlLocale);
  const userName = (key: string) => getUserConfig(key)?.displayName ?? key;
  const owner = event.owner === SHARED_OWNER ? t("common.shared") : userName(event.owner);

  return (
    <Dialog.Root
      open
      onOpenChange={(details) => !details.open && onClose()}
      size={{ base: "full", md: "md" }}
      placement="center"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content css={dialogFromMdUp}>
            <Dialog.Header>
              <HStack gap="3" align="start">
                {/* The owner's color, as in the calendar; the owner is also written below. */}
                <Box flexShrink="0" w="4" h="4" mt="1.5" borderRadius="sm" bg={color} />
                <Dialog.Title overflowWrap="anywhere">{event.title}</Dialog.Title>
              </HStack>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap="5">
                <Stack gap="0.5">
                  <Text fontWeight="medium">{when.dates}</Text>
                  {/* Left to right, as on a clock: right to left would read "11:00–10:00". */}
                  {when.times && (
                    <Text dir="ltr" alignSelf="start">
                      {when.times}
                    </Text>
                  )}
                  {event.isAllDay && <Text color="fg.muted">{t("eventDetails.allDay")}</Text>}
                </Stack>

                <DataList.Root orientation="horizontal" gap="3">
                  <DataList.Item>
                    <DataList.ItemLabel>{t("eventDetails.owner")}</DataList.ItemLabel>
                    <DataList.ItemValue>{owner}</DataList.ItemValue>
                  </DataList.Item>
                  <DataList.Item>
                    <DataList.ItemLabel>{t("eventDetails.category")}</DataList.ItemLabel>
                    <DataList.ItemValue>{t(`categories.${event.category}`)}</DataList.ItemValue>
                  </DataList.Item>
                  {event.location && (
                    <DataList.Item>
                      <DataList.ItemLabel>{t("eventDetails.location")}</DataList.ItemLabel>
                      <DataList.ItemValue overflowWrap="anywhere">
                        {event.location}
                      </DataList.ItemValue>
                    </DataList.Item>
                  )}
                  {event.description && (
                    <DataList.Item>
                      <DataList.ItemLabel>{t("eventDetails.description")}</DataList.ItemLabel>
                      <DataList.ItemValue whiteSpace="pre-wrap" overflowWrap="anywhere">
                        {event.description}
                      </DataList.ItemValue>
                    </DataList.Item>
                  )}
                </DataList.Root>

                <Text fontSize="sm" color="fg.muted">
                  {t("eventDetails.createdBy", { name: userName(event.createdBy) })}
                  {/* Every change raises the version, so 1 means never edited. */}
                  {event.version > 1 &&
                    ` · ${t("eventDetails.updatedBy", { name: userName(event.updatedBy) })}`}
                </Text>
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" colorPalette="red" onClick={onDelete}>
                {t("eventDetails.delete")}
              </Button>
              <Button onClick={onEdit}>{t("eventDetails.edit")}</Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" aria-label={t("eventDetails.close")} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
