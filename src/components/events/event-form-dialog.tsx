"use client";

import {
  Alert,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Field,
  Grid,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Textarea,
} from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { createEventAction, updateEventAction } from "@/app/(app)/event-actions";
import { appConfig } from "@/config/app.config";
import { type EventFormValues, toEventInput, withAllDay, withStart } from "@/modules/events/form";
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  SHARED_OWNER,
  TITLE_MAX,
} from "@/modules/events/validation";
import type { EventField } from "@/modules/events/validation";
import { dialogFromMdUp } from "./dialog-styles";

type Props = {
  initialValues: EventFormValues;
  /** The event being edited, at the version that was loaded; absent for a new event. */
  editing?: { id: string; version: number };
  onClose: () => void;
  /** Called after a successful save, before the dialog closes. */
  onSaved: () => void;
  /**
   * Called when the save was refused because the event was changed or deleted
   * meanwhile, so the calendar can reload it. The form stays open with the message.
   */
  onStale: () => void;
};

/**
 * The form for a new event, or for editing one. Rendered only while open, so every
 * opening starts from fresh values. Full screen on phones, a dialog on larger screens.
 */
export function EventFormDialog({ initialValues, editing, onClose, onSaved, onStale }: Props) {
  const t = useTranslations();
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<EventField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    try {
      const input = toEventInput(values);
      const result = editing
        ? await updateEventAction(editing.id, editing.version, input)
        : await createEventAction(input);
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      if ("fieldErrors" in result) {
        setFieldErrors(result.fieldErrors);
      } else {
        setFieldErrors({});
        setFormError(result.message);
        onStale();
      }
    } catch {
      setFormError(t("eventForm.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  const owners = [
    ...appConfig.users.map((user) => ({ value: user.key, label: user.displayName })),
    { value: SHARED_OWNER, label: t("common.shared") },
  ];

  const field = (name: EventField) => ({ invalid: Boolean(fieldErrors[name]) });
  const error = (name: EventField) =>
    fieldErrors[name] && <Field.ErrorText>{fieldErrors[name]}</Field.ErrorText>;

  return (
    <Dialog.Root
      open
      onOpenChange={(details) => !details.open && onClose()}
      size={{ base: "full", md: "lg" }}
      placement="center"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content css={dialogFromMdUp}>
            <Dialog.Header>
              <Dialog.Title>
                {editing ? t("eventForm.editTitle") : t("eventForm.createTitle")}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <form id="event-form" onSubmit={submit} noValidate>
                <Stack gap="4">
                  {formError && (
                    <Alert.Root status="error">
                      <Alert.Indicator />
                      <Alert.Title>{formError}</Alert.Title>
                    </Alert.Root>
                  )}

                  <Field.Root required {...field("title")}>
                    <Field.Label>{t("eventForm.title")}</Field.Label>
                    <Input
                      value={values.title}
                      onChange={(e) => set("title", e.target.value)}
                      maxLength={TITLE_MAX}
                      autoFocus
                    />
                    {error("title")}
                  </Field.Root>

                  <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="4">
                    <Field.Root {...field("owner")}>
                      <Field.Label>{t("eventForm.owner")}</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          value={values.owner}
                          onChange={(e) => set("owner", e.target.value)}
                        >
                          {owners.map((owner) => (
                            <option key={owner.value} value={owner.value}>
                              {owner.label}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                      {error("owner")}
                    </Field.Root>

                    <Field.Root {...field("category")}>
                      <Field.Label>{t("eventForm.category")}</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          value={values.category}
                          onChange={(e) => set("category", e.target.value)}
                        >
                          {appConfig.categories.map((category) => (
                            <option key={category.key} value={category.key}>
                              {t(`categories.${category.key}`)}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                      {error("category")}
                    </Field.Root>
                  </Grid>

                  <Checkbox.Root
                    checked={values.isAllDay}
                    onCheckedChange={(details) =>
                      setValues((current) => withAllDay(current, details.checked === true))
                    }
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label>{t("eventForm.allDay")}</Checkbox.Label>
                  </Checkbox.Root>

                  <Grid templateColumns={values.isAllDay ? "1fr" : "1fr 1fr"} gap="4">
                    <Field.Root required {...field("startDate")}>
                      <Field.Label>{t("eventForm.startDate")}</Field.Label>
                      <Input
                        type="date"
                        value={values.startDate}
                        onChange={(e) =>
                          setValues((current) =>
                            withStart(current, e.target.value, current.startTime),
                          )
                        }
                      />
                      {error("startDate")}
                    </Field.Root>
                    {/* "All day" hides the times rather than disabling them. */}
                    {!values.isAllDay && (
                      <Field.Root required {...field("startTime")}>
                        <Field.Label>{t("eventForm.startTime")}</Field.Label>
                        <Input
                          type="time"
                          value={values.startTime}
                          onChange={(e) =>
                            setValues((current) =>
                              withStart(current, current.startDate, e.target.value),
                            )
                          }
                        />
                        {error("startTime")}
                      </Field.Root>
                    )}
                  </Grid>

                  <Grid templateColumns={values.isAllDay ? "1fr" : "1fr 1fr"} gap="4">
                    <Field.Root required {...field("endDate")}>
                      <Field.Label>
                        {values.isAllDay ? t("eventForm.lastDay") : t("eventForm.endDate")}
                      </Field.Label>
                      <Input
                        type="date"
                        value={values.endDate}
                        onChange={(e) => set("endDate", e.target.value)}
                      />
                      {error("endDate")}
                    </Field.Root>
                    {!values.isAllDay && (
                      <Field.Root required {...field("endTime")}>
                        <Field.Label>{t("eventForm.endTime")}</Field.Label>
                        <Input
                          type="time"
                          value={values.endTime}
                          onChange={(e) => set("endTime", e.target.value)}
                        />
                        {error("endTime")}
                      </Field.Root>
                    )}
                  </Grid>

                  <Field.Root {...field("location")}>
                    <Field.Label>
                      {t("eventForm.location")}{" "}
                      <Field.RequiredIndicator fallback={t("eventForm.optional")} />
                    </Field.Label>
                    <Input
                      value={values.location}
                      onChange={(e) => set("location", e.target.value)}
                      maxLength={LOCATION_MAX}
                    />
                    {error("location")}
                  </Field.Root>

                  <Field.Root {...field("description")}>
                    <Field.Label>
                      {t("eventForm.description")}{" "}
                      <Field.RequiredIndicator fallback={t("eventForm.optional")} />
                    </Field.Label>
                    <Textarea
                      value={values.description}
                      onChange={(e) => set("description", e.target.value)}
                      maxLength={DESCRIPTION_MAX}
                      rows={3}
                    />
                    {error("description")}
                  </Field.Root>
                </Stack>
              </form>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                {t("eventForm.cancel")}
              </Button>
              <Button
                type="submit"
                form="event-form"
                loading={pending}
                loadingText={t("common.saving")}
              >
                {t("common.save")}
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" aria-label={t("eventForm.close")} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
