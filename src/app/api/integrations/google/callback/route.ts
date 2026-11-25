import type { NextRequest } from "next/server";
import { redirectTo } from "@/lib/redirect";
import { getCurrentUser } from "@/modules/auth/current-user";
import { type ConnectResult, saveConnection } from "@/modules/google-export/connection";
import {
  FLOW_COOKIE,
  FLOW_COOKIE_OPTIONS,
  decodeFlow,
  sameState,
} from "@/modules/google-export/flow-cookie";
import { GoogleApiError } from "@/modules/google-export/google-api";
import { exchangeCode, hasCalendarScope } from "@/modules/google-export/oauth";
import { exportSoon } from "@/modules/google-export/trigger";

/**
 * GET /api/integrations/google/callback
 * Where Google sends the browser back after the consent page. The answer counts only
 * for the user who started connecting, in this browser (the state in the cookie).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return redirectTo("/login");

  const flow = decodeFlow(request.cookies.get(FLOW_COOKIE)?.value);
  const params = request.nextUrl.searchParams;
  const toSettings = (result: ConnectResult) =>
    redirectTo(`/settings?google=${result}#google-export`);

  // An answer that isn't for this user's flow in this browser (a forged link, or an old
  // one) changes nothing: not even the flow, which the real answer may still finish.
  const state = params.get("state");
  if (!flow || !state || flow.userId !== user.id || !sameState(state, flow.state)) {
    return toSettings("failed");
  }
  const done = (result: ConnectResult) => {
    const response = toSettings(result);
    response.cookies.set(FLOW_COOKIE, "", { ...FLOW_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  };

  const error = params.get("error");
  if (error) return done(error === "access_denied" ? "denied" : "failed");
  const code = params.get("code");
  if (!code) return done("failed");

  try {
    const access = await exchangeCode(code, flow.verifier);
    // Google lets the user untick the calendar permission on the consent page.
    if (!hasCalendarScope(access.grantedScopes)) return done("missingScope");
    await saveConnection(user.id, access);
    // Creates the calendar and exports every event, after the redirect is sent.
    exportSoon();
  } catch (failure) {
    // Never the token or Google's message: only the status and reason.
    const detail = failure instanceof GoogleApiError ? failure.message : "unexpected";
    console.error("Connecting Google export failed:", detail);
    return done("failed");
  }
  return done("connected");
}
