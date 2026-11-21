import { describe, expect, it } from "vitest";
import { decodeFlow, encodeFlow, sameState } from "./flow-cookie";

describe("the connect flow's cookie", () => {
  it("round-trips, and anything else reads as no flow", () => {
    const flow = { state: "s", verifier: "v", userId: "u" };
    expect(decodeFlow(encodeFlow(flow))).toEqual(flow);
    expect(decodeFlow(undefined)).toBeNull();
    expect(decodeFlow("not base64 json")).toBeNull();
    expect(decodeFlow(encodeFlow({ ...flow, state: "" }))).toBeNull();
    expect(decodeFlow(Buffer.from('{"state":1}').toString("base64url"))).toBeNull();
  });

  it("compares states exactly", () => {
    expect(sameState("abc", "abc")).toBe(true);
    expect(sameState("abc", "abd")).toBe(false);
    expect(sameState("abc", "abcd")).toBe(false);
  });
});
