"use client";

import { Button } from "@chakra-ui/react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    // Navigates away to Google; on failure Better Auth sends the browser to /login?error=...
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/login",
    });
  }

  return (
    <Button onClick={signIn} loading={pending} size="lg" w="full">
      {label}
    </Button>
  );
}
