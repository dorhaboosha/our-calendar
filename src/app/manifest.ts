import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";
import { appConfig } from "@/config/app.config";

/**
 * The Web App Manifest (spec 8.1): installing OurCalendar on a phone's home screen, where
 * it opens in its own window, without the browser's bar. Icons: src/app/icons/[name].
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // The locale is given, so this needs no request: it is made once, at build time.
  const t = await getTranslations({ locale: appConfig.locale, namespace: "app" });
  const icon = (name: string, size: number, purpose: "any" | "maskable") => ({
    src: `/icons/${name}`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  });
  return {
    id: "/",
    name: t("name"),
    short_name: t("name"),
    description: t("description"),
    lang: appConfig.locale,
    dir: appConfig.direction,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: appConfig.themeColor,
    icons: [
      icon("icon-192.png", 192, "any"),
      icon("icon-512.png", 512, "any"),
      icon("maskable-192.png", 192, "maskable"),
      icon("maskable-512.png", 512, "maskable"),
    ],
  };
}
