import { Center, Heading, Link, Spinner, Stack, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getCurrentUser } from "@/modules/auth/current-user";
import { NOT_ALLOWED } from "@/modules/auth/hooks";
import { GoogleSignInButton } from "./google-sign-in-button";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Center as="main" minH="100vh" px="4">
      <Stack gap="6" maxW="sm" w="full" textAlign="center">
        <Suspense fallback={<Spinner size="lg" mx="auto" />}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </Stack>
    </Center>
  );
}

// Reads the session and ?error=..., which are request-time data, so it renders
// behind the Suspense boundary.
async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  if (await getCurrentUser()) redirect("/");

  const t = await getTranslations("login");
  const { error } = await searchParams;

  return (
    <>
      <Heading size="2xl">{t("title")}</Heading>
      {/* Says plainly what the site is, so the page doesn't read like a fake Google login. */}
      <Text>{t("about")}</Text>
      <Text color="fg.muted">{t("subtitle")}</Text>
      {error && (
        <Text role="alert" color="fg.error">
          {error === NOT_ALLOWED ? t("errors.notAllowed") : t("errors.generic")}
        </Text>
      )}
      <GoogleSignInButton label={t("google")} />
      <Text color="fg.muted" fontSize="sm">
        {t("googleNote")}
      </Text>
      <Link asChild colorPalette="blue" fontSize="sm" mx="auto">
        <NextLink href="/privacy">{t("privacyLink")}</NextLink>
      </Link>
    </>
  );
}
