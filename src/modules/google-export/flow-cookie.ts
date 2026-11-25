// The short-lived cookie that carries the OAuth state, PKCE verifier and user from the
// connect route to the callback. httpOnly, so page scripts can't read the verifier;
// SameSite=Lax, so it comes along when Google sends the browser back.

import { timingSafeEqual } from "node:crypto";

export const FLOW_COOKIE = "google_export_oauth";

export type Flow = { state: string; verifier: string; userId: string };

export const FLOW_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/integrations/google",
  /** Ten minutes to approve on Google's page. */
  maxAge: 10 * 60,
};

export function encodeFlow(flow: Flow): string {
  return Buffer.from(JSON.stringify(flow)).toString("base64url");
}

export function decodeFlow(value: string | undefined): Flow | null {
  if (!value) return null;
  try {
    const flow = JSON.parse(Buffer.from(value, "base64url").toString());
    const fields = [flow?.state, flow?.verifier, flow?.userId];
    return fields.every((field) => typeof field === "string" && field) ? (flow as Flow) : null;
  } catch {
    return null;
  }
}

/** Compares the state Google sent back with the one kept, in constant time. */
export function sameState(received: string, kept: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(kept);
  return a.length === b.length && timingSafeEqual(a, b);
}
