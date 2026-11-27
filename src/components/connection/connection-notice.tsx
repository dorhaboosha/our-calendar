"use client";

import { Box, Text } from "@chakra-ui/react";
import { useSyncExternalStore } from "react";
import { isDisconnected, isDisconnectedOnServer, subscribeToConnection } from "./connection-state";

/** Under the header, while the app can't reach the server (spec 8.1). */
export function ConnectionNotice({ text }: { text: string }) {
  const disconnected = useSyncExternalStore(
    subscribeToConnection,
    isDisconnected,
    isDisconnectedOnServer,
  );
  if (!disconnected) return null;
  return (
    <Box bg="bg.error" borderBottomWidth="1px" borderColor="border.error" px="4" py="2">
      <Text role="alert" color="fg.error" textAlign="center" maxW="6xl" mx="auto">
        {text}
      </Text>
    </Box>
  );
}
