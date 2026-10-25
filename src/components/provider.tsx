"use client";

import {
  ChakraProvider,
  LocaleProvider,
  createSystem,
  defaultConfig,
  defineConfig,
} from "@chakra-ui/react";
import type { ReactNode } from "react";

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
    },
  }),
);

/** Chakra theme plus the locale, which Chakra's components use for RTL-aware behavior. */
export function Provider({ locale, children }: { locale: string; children: ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <LocaleProvider locale={locale}>{children}</LocaleProvider>
    </ChakraProvider>
  );
}
