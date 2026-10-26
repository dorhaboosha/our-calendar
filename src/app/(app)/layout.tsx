import { Box, Center, Spinner } from "@chakra-ui/react";
import { Suspense, type ReactNode } from "react";
import { requireUser } from "@/modules/auth/current-user";
import { AppHeader } from "./app-header";

// Every page in the (app) group requires a signed-in user.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <Center minH="100vh">
          <Spinner size="lg" />
        </Center>
      }
    >
      <SignedIn>{children}</SignedIn>
    </Suspense>
  );
}

// Reads the session (request-time data), so it renders behind the Suspense boundary.
// Children render only after the check passes; without a session requireUser redirects.
async function SignedIn({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <Box minH="100vh">
      <AppHeader displayName={user.displayName} color={user.color} />
      {children}
    </Box>
  );
}
