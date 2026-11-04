"use client";

import { Box, Button, HStack, Input, Stack, Text, chakra } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { checkCalendarColor, textColorFor } from "@/modules/users/colors";
import type { SaveColorResult } from "./actions";

type Props = {
  /** Whose events the color is for, as shown in the preview ("דור", "משותף"). */
  previewName: string;
  currentColor: string;
  palette: string[];
  /** Colors already in use, keyed by label. Swatches too close to them are disabled. */
  others: Record<string, string>;
  /** The server action that saves the color. */
  save: (color: string) => Promise<SaveColorResult>;
};

/** Picks one calendar color: a user's own, or the shared events' color. */
export function ColorForm({ previewName, currentColor, palette, others, save: saveColor }: Props) {
  const t = useTranslations();
  // Unique per form: the settings page has more than one.
  const id = useId();
  const [color, setColor] = useState(currentColor);
  // The saved color can change under the form (the other user changed the shared
  // color, then this page was refreshed). Follow it, unless a new color was picked here.
  const [savedColor, setSavedColor] = useState(currentColor);
  if (currentColor !== savedColor) {
    setSavedColor(currentColor);
    if (color === savedColor) setColor(currentColor);
  }
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    setColor(next.toLowerCase());
    setStatus(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveColor(color);
      setStatus(result.ok ? { ok: true, message: t("common.saved") } : result);
    });
  }

  return (
    <Stack gap="5">
      <Stack gap="2">
        <Text id={`${id}-palette`} fontWeight="medium">
          {t("settings.palette")}
        </Text>
        <HStack gap="2" wrap="wrap" role="radiogroup" aria-labelledby={`${id}-palette`}>
          {palette.map((swatch) => {
            // Same rules the server applies on save; here they only grey out swatches.
            const available = checkCalendarColor(swatch, others).ok;
            const selected = swatch === color;
            return (
              <chakra.button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={available ? swatch : t("settings.swatchTaken", { color: swatch })}
                disabled={!available}
                onClick={() => choose(swatch)}
                bg={swatch}
                w="9"
                h="9"
                borderRadius="full"
                borderWidth="3px"
                borderColor={selected ? "fg" : "transparent"}
                outline={selected ? "2px solid" : undefined}
                outlineColor="bg"
                outlineOffset="-5px"
                opacity={available ? 1 : 0.25}
                cursor={available ? "pointer" : "not-allowed"}
              />
            );
          })}
        </HStack>
      </Stack>

      <HStack gap="3">
        <label htmlFor={`${id}-custom`}>
          <Text as="span" fontWeight="medium">
            {t("settings.custom")}
          </Text>
        </label>
        <Input
          id={`${id}-custom`}
          type="color"
          value={color}
          onChange={(event) => choose(event.target.value)}
          w="16"
          p="1"
        />
      </HStack>

      <Stack gap="2">
        <Text fontWeight="medium">{t("settings.preview")}</Text>
        <Box
          bg={color}
          color={textColorFor(color)}
          px="3"
          py="2"
          borderRadius="md"
          w="fit-content"
          data-testid="color-preview"
        >
          {t("settings.previewEvent", { name: previewName })}
        </Box>
      </Stack>

      <HStack gap="3">
        <Button onClick={save} loading={pending} loadingText={t("common.saving")}>
          {t("common.save")}
        </Button>
        {status && (
          <Text role="status" color={status.ok ? "fg.success" : "fg.error"}>
            {status.message}
          </Text>
        )}
      </HStack>
    </Stack>
  );
}
