import { NextResponse } from "next/server";
import { redirectTo } from "@/lib/redirect";
import { getCurrentUser } from "@/modules/auth/current-user";
import { FLOW_COOKIE, FLOW_COOKIE_OPTIONS, encodeFlow } from "@/modules/google-export/flow-cookie";
import { startAuthorization } from "@/modules/google-export/oauth";

/**
 * GET /api/integrations/google/connect
 * Starts connecting the signed-in user's Google account to the export: sends the
 * browser to Google's consent page, asking only for the calendars the app creates.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return redirectTo("/login");

  let authorization: ReturnType<typeof startAuthorization>;
  try {
    authorization = startAuthorization();
  } catch (error) {
    console.error("Google export is not configured:", (error as Error).message);
    return redirectTo("/settings?google=failed#google-export");
  }
  const { url, state, verifier } = authorization;
  const response = NextResponse.redirect(url);
  response.cookies.set(
    FLOW_COOKIE,
    encodeFlow({ state, verifier, userId: user.id }),
    FLOW_COOKIE_OPTIONS,
  );
  return response;
}
