import { Box, HStack, Heading, Link, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { getTranslations } from "next-intl/server";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

type Props = {
  displayName: string;
  color: string;
  /** The user's Google export waits for them (access revoked, or calendar deleted). */
  exportNeedsAction: boolean;
};

export async function AppHeader({ displayName, color, exportNeedsAction }: Props) {
  const t = await getTranslations();

  return (
    <Box as="header" borderBottomWidth="1px" px={{ base: "4", md: "6" }} py="3">
      <HStack justify="space-between" maxW="6xl" mx="auto" gap="4" wrap="wrap">
        <HStack gap="6">
          <HStack gap="2">
            {/* The logo, next to the name that says it (spec 8.1). */}
            {/* eslint-disable-next-line @next/next/no-img-element -- a small SVG, nothing to optimize */}
            <img src="/logo.svg" alt="" width={28} height={28} />
            <Heading size="lg">{t("app.name")}</Heading>
          </HStack>
          <NavLinks
            label={t("header.nav")}
            links={[
              { href: "/", label: t("header.home") },
              { href: "/settings", label: t("header.settings") },
            ]}
          />
        </HStack>
        <HStack gap="3" wrap="wrap">
          {exportNeedsAction && (
            <Link asChild color="fg.error" fontWeight="medium">
              <NextLink href="/settings#google-export">{t("header.exportNeedsAction")}</NextLink>
            </Link>
          )}
          <HStack gap="2">
            <Box w="3" h="3" borderRadius="full" bg={color} aria-hidden />
            <Text>{t("header.signedInAs", { name: displayName })}</Text>
          </HStack>
          <SignOutButton label={t("header.signOut")} />
        </HStack>
      </HStack>
    </Box>
  );
}
