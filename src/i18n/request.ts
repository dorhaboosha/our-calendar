import { getRequestConfig } from "next-intl/server";
import { appConfig } from "@/config/app.config";

// A single, fixed locale from app.config.ts (no locale in the URL).
export default getRequestConfig(async () => {
  const locale = appConfig.locale;
  return {
    locale,
    timeZone: appConfig.timeZone,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
