import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Provider } from "@/components/provider";
import { appConfig } from "@/config/app.config";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("name"), description: t("description") };
}

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
