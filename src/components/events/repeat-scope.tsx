"use client";

import { Alert, Button, Dialog, Portal, RadioGroup, Stack } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { REPEAT_SCOPES, type RepeatScope } from "@/modules/events/recurrence";

/** "This occurrence / this and following / all": what a change to a series applies to. */
export function RepeatScopeChoice({
  value,
  onChange,
}: {
  value: RepeatScope;
  onChange: (scope: RepeatScope) => void;
}) {
  const t = useTranslations("repeatScope");
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(details) => details.value && onChange(details.value as RepeatScope)}
    >
      <RadioGroup.Label srOnly>{t("label")}</RadioGroup.Label>
      <Stack gap="3">
        {REPEAT_SCOPES.map((scope) => (
          <RadioGroup.Item key={scope} value={scope}>
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>{t(scope)}</RadioGroup.ItemText>
          </RadioGroup.Item>
        ))}
      </Stack>
    </RadioGroup.Root>
  );
}

type Props = {
  /**
   * Called with the choice. Resolves to null when the form can open, or to a message
   * to show (the series couldn't be loaded).
   */
  onChoose: (scope: RepeatScope) => Promise<string | null>;
  /** "Cancel": back to the event's details, also while the series is loading. */
  onCancel: () => void;
};

/** Before editing an occurrence of a series: which occurrences the edit is for. */
export function EditScopeDialog({ onChoose, onCancel }: Props) {
  const t = useTranslations("repeatScope");
  const [scope, setScope] = useState<RepeatScope>("this");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function choose() {
    setPending(true);
    setError(null);
    try {
      setError(await onChoose(scope));
    } catch {
      setError(t("loadFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(details) => !details.open && onCancel()}
      size="sm"
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{t("editTitle")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body display="flex" flexDirection="column" gap="4">
              <RepeatScopeChoice value={scope} onChange={setScope} />
              {error && (
                <Alert.Root status="error">
                  <Alert.Indicator />
                  <Alert.Title>{error}</Alert.Title>
                </Alert.Root>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" onClick={onCancel}>
                {t("cancel")}
              </Button>
              <Button onClick={choose} loading={pending} loadingText={t("loading")}>
                {t("continue")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
