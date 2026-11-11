import { describe, expect, it } from "vitest";
import { safeUrl } from "@/lib/push";
import { urlBase64ToUint8Array } from "@/lib/pwa/push-client";

describe("push helpers", () => {
  it("converts a URL-safe VAPID key to bytes", () => {
    const bytes = urlBase64ToUint8Array("AQID_w");
    expect([...bytes]).toEqual([1, 2, 3, 255]);
  });
  it("only ever opens in-app paths", () => {
    expect(safeUrl("/ai-bdm")).toBe("/ai-bdm");
    expect(safeUrl("https://evil.example")).toBe("/");
    expect(safeUrl("//evil.example")).toBe("/");
    expect(safeUrl(undefined)).toBe("/");
  });
});
