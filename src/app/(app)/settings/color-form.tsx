"use client";

import { Box, Button, HStack, Input, Stack, Text, chakra } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { checkUserColor, textColorFor } from "@/modules/users/colors";
import { saveMyColor } from "./actions";

type Props = {
  displayName: string;
  currentColor: string;
  palette: string[];
  /** Colors already in use, keyed by label. Swatches too close to them are disabled. */
  others: Record<string, string>;
};

export function ColorForm({ displayName, currentColor, palette, others }: Props) {
  const t = useTranslations();
  const [color, setColor] = useState(currentColor);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    setColor(next.toLowerCase());
    setStatus(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveMyColor(color);
      setStatus(result.ok ? { ok: true, message: t("common.saved") } : result);
    });
  }

  return (
    <Stack gap="5">
      <Stack gap="2">
        <Text id="palette-label" fontWeight="medium">
          {t("settings.palette")}
        </Text>
        <HStack gap="2" wrap="wrap" role="radiogroup" aria-labelledby="palette-label">
          {palette.map((swatch) => {
            // Same rules the server applies on save; here they only grey out swatches.
            const available = checkUserColor(swatch, others).ok;
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
        <label htmlFor="custom-color">
          <Text as="span" fontWeight="medium">
            {t("settings.custom")}
          </Text>
        </label>
        <Input
          id="custom-color"
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
          {t("settings.previewEvent", { name: displayName })}
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
