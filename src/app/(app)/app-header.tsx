import { Box, HStack, Heading, Text } from "@chakra-ui/react";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "./sign-out-button";

type Props = {
  displayName: string;
  color: string;
};

export async function AppHeader({ displayName, color }: Props) {
  const t = await getTranslations();

  return (
    <Box as="header" borderBottomWidth="1px" px={{ base: "4", md: "6" }} py="3">
      <HStack justify="space-between" maxW="6xl" mx="auto" gap="4">
        <Heading size="lg">{t("app.name")}</Heading>
        <HStack gap="3">
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
