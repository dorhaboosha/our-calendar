import { Center, Heading, Spinner, Stack, Text } from "@chakra-ui/react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
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

// Reads ?error=..., which is request-time data, so it renders behind the Suspense boundary.
async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const t = await getTranslations("login");
  const { error } = await searchParams;

  return (
    <>
      <Heading size="2xl">{t("title")}</Heading>
      <Text color="fg.muted">{t("subtitle")}</Text>
      {error && (
        <Text role="alert" color="fg.error">
          {error === NOT_ALLOWED ? t("errors.notAllowed") : t("errors.generic")}
        </Text>
      )}
      <GoogleSignInButton label={t("google")} />
    </>
  );
}
