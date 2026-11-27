import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Provider } from "@/components/provider";
import { appConfig } from "@/config/app.config";
import "./touch-targets.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: t("name"),
    description: t("description"),
    // All made from public/logo.svg (spec 8.1). The manifest comes from app/manifest.ts.
    icons: {
      icon: [
        { url: "/logo.svg", type: "image/svg+xml" },
        { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    // On an iPhone, added to the home screen: opens without the browser's bar, named so.
    appleWebApp: { capable: true, title: t("name"), statusBarStyle: "default" },
  };
}

export const viewport: Viewport = { themeColor: appConfig.themeColor };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={appConfig.locale} dir={appConfig.direction} className={heebo.variable}>
      <body>
        <NextIntlClientProvider>
          <Provider locale={appConfig.intlLocale}>{children}</Provider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
