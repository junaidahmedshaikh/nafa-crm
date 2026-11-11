import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

const ACTIONS = path.resolve(__dirname, "../../src/lib/actions");
// login/logout run before a session exists; addMembersByContact only delegates to an authorised action.
const ALLOWED = new Set(["auth.ts:login", "auth.ts:logout", "recipient-groups.ts:addMembersByContact"]);

describe("server actions", () => {
  it("every exported server action authorises the caller", () => {
    const offenders: string[] = [];
    for (const f of fs.readdirSync(ACTIONS).filter((f) => f.endsWith(".ts"))) {
      const src = fs.readFileSync(path.join(ACTIONS, f), "utf8");
      if (!src.includes('"use server"')) continue;
      for (const m of src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}\n/g)) {
        if (!/authorized(<[^(]*>)?\(|getMember|requireMember/.test(m[2]) && !ALLOWED.has(`${f}:${m[1]}`)) offenders.push(`${f}:${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("'use server' files export only async functions (no constants that become public endpoints)", () => {
    for (const f of fs.readdirSync(ACTIONS).filter((f) => f.endsWith(".ts"))) {
      const src = fs.readFileSync(path.join(ACTIONS, f), "utf8");
      if (!src.includes('"use server"')) continue;
      expect(src.match(/^export (const|let|var|class) /gm) ?? [], f).toEqual([]);
    }
  });
});

describe("rate limiter fallback", () => {
  it("refuses when it cannot check and the action sends email (fail closed), allows otherwise", async () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(await rateLimit("k", 1, 60, { failClosed: true })).toBe(false);
      expect(await rateLimit("k", 1, 60)).toBe(true);
    } finally {
      if (saved !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
    }
  });
});
