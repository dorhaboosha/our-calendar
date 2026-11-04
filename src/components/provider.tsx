"use client";

import {
  ChakraProvider,
  LocaleProvider,
  createSystem,
  defaultConfig,
  defineConfig,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import { EmotionRegistry } from "./emotion-registry";

const system = createSystem(
  defaultConfig,
  defineConfig({
    theme: {
      tokens: {
        fonts: {
          heading: { value: "var(--font-heebo), system-ui, sans-serif" },
          body: { value: "var(--font-heebo), system-ui, sans-serif" },
        },
      },
      semanticTokens: {
        colors: {
          // Chakra's defaults (red.500, green.600) are below WCAG's 4.5:1 for text on white.
          fg: {
            error: { value: { _light: "{colors.red.700}", _dark: "{colors.red.400}" } },
            success: { value: { _light: "{colors.green.700}", _dark: "{colors.green.400}" } },
          },
        },
      },
    },
  }),
);

/** Chakra theme plus the locale, which Chakra's components use for RTL-aware behavior. */
export function Provider({ locale, children }: { locale: string; children: ReactNode }) {
  return (
    <EmotionRegistry>
      <ChakraProvider value={system}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </ChakraProvider>
    </EmotionRegistry>
  );
}
