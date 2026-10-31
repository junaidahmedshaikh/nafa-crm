import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, INACTIVE_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

const MEMBER = "00000000-0000-0000-0000-0000000000f1";
let db: PGlite;
beforeAll(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, email) values ('${MEMBER}','m@x'); insert into public.profiles (id, full_name, role) values ('${MEMBER}','Member','member');`);
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const pref = (id: string) => q<{ theme_preference: string }>(`select theme_preference from profiles where id = $1`, [id]).then((r) => r[0].theme_preference);

describe("theme preference", () => {
  it("defaults to light, so nobody's existing look changes", async () => {
    expect(await pref(MEMBER)).toBe("light");
    expect(await pref(ADMIN_ID)).toBe("light");
  });

  it("lets a user set light, dark or system for themselves only", async () => {
    for (const t of ["dark", "system", "light", "dark"]) {
      await asUser(db, MEMBER, () => q(`select public.set_theme_preference($1)`, [t]));
      expect(await pref(MEMBER)).toBe(t);
    }
    expect(await pref(ADMIN_ID)).toBe("light"); // someone else's row is untouched
  });

  it("rejects unknown values and people without access", async () => {
    await expect(asUser(db, MEMBER, () => q(`select public.set_theme_preference('neon')`))).rejects.toThrow(/INVALID_THEME/);
    await expect(asUser(db, MEMBER, () => q(`select public.set_theme_preference(null)`))).rejects.toThrow();
    await expect(asUser(db, OUTSIDER_ID, () => q(`select public.set_theme_preference('dark')`))).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(asUser(db, INACTIVE_ID, () => q(`select public.set_theme_preference('dark')`))).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(asUser(db, null, () => q(`select public.set_theme_preference('dark')`))).rejects.toThrow();
  });

  it("does not open up the rest of the profile to direct updates", async () => {
    await expect(asUser(db, MEMBER, () => q(`update profiles set theme_preference = 'dark' where id = $1`, [MEMBER]))).rejects.toThrow();
    await expect(asUser(db, MEMBER, () => q(`update profiles set role = 'admin' where id = $1`, [MEMBER]))).rejects.toThrow();
  });
});
