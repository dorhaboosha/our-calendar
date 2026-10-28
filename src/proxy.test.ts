import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const SESSION_COOKIE = "better-auth.session_token=some-token";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("proxy", () => {
  it("redirects to /login when there is no session cookie", () => {
    const response = proxy(request("/settings"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets the request through when a session cookie exists", () => {
    const response = proxy(request("/", SESSION_COOKIE));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("runs on app pages", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/settings")).toBe(true);
  });

  it("skips the login page, API routes, Next.js internals and static files", () => {
    expect(matches("/login")).toBe(false);
    expect(matches("/api/auth/get-session")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
  });
});
