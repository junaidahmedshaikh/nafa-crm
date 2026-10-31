import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

const MEMBER = "00000000-0000-0000-0000-0000000000e1";
const ADMIN2 = "00000000-0000-0000-0000-0000000000e2";
const OTHER = "00000000-0000-0000-0000-0000000000e3";
const DEV_A = "a1a1a1a1-a1a1-4a1a-a1a1-a1a1a1a1a1a1";
const DEV_B = "b2b2b2b2-b2b2-4b2b-b2b2-b2b2b2b2b2b2";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${MEMBER}','junaid@nafa.test'), ('${ADMIN2}','admin2@nafa.test'), ('${OTHER}','other@nafa.test');
    insert into public.profiles (id, full_name, role) values ('${MEMBER}','Junaid Shaikh','member'), ('${ADMIN2}','Second Admin','admin'), ('${OTHER}','Other Member','member');
  `);
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const as = <T>(id: string | null, fn: () => Promise<T>) => asUser(db, id, fn);
type Res = { recorded: boolean; created?: boolean; install_id?: string; message?: string; email_to?: string[] };
const record = (device: string, event: string, o: { platform?: string; browser?: string; source?: string } = {}) =>
  q<{ r: Res }>(`select public.record_app_install($1,$2,$3,$4,$5) as r`, [device, o.platform ?? "android", o.browser ?? "Chrome", o.source ?? "pwa", event]).then((x) => x[0].r);
const inbox = (id: string) => as(id, () => q<{ title: string; body: string; read_at: string | null; data: Record<string, unknown> }>(`select title, body, read_at, data from notifications order by created_at`));
const reset = async () => {
  await db.exec(`delete from notifications; delete from app_installs; update install_alert_settings set enabled = true, extra_recipients = '{}', email_enabled = false, alert_emails = '{}';`);
};

describe("recording installations", () => {
  it("records an install, alerts every admin once (not the installer) and never alerts again for the same device", async () => {
    await reset();
    const first = await as(MEMBER, () => record(DEV_A, "installed", { platform: "android", browser: "Chrome" }));
    expect(first).toMatchObject({ recorded: true, created: true });
    expect(first.message).toBe("Junaid Shaikh has installed the NAFA CRM app on an Android device.");
    const again = await as(MEMBER, () => record(DEV_A, "installed"));
    expect(again).toMatchObject({ recorded: true, created: false, install_id: first.install_id });

    for (const admin of [ADMIN_ID, ADMIN2]) {
      const n = await inbox(admin);
      expect(n).toHaveLength(1);
      expect(n[0].title).toBe("New CRM App Installation");
      expect(n[0].data).toMatchObject({ user_name: "Junaid Shaikh", user_email: "junaid@nafa.test", platform: "android", browser: "Chrome", source: "pwa", device_number: 1 });
      expect(n[0].data.installed_at).toBeTruthy();
    }
    expect(await inbox(MEMBER)).toHaveLength(0); // members are not alerted unless chosen
    expect(await inbox(OTHER)).toHaveLength(0);
  });

  it("does not treat a heartbeat or a plain browser visit as an installation", async () => {
    await reset();
    expect(await as(MEMBER, () => record(DEV_A, "active"))).toEqual({ recorded: false });
    expect(await q(`select * from app_installs`)).toHaveLength(0);
    expect(await inbox(ADMIN_ID)).toHaveLength(0);
  });

  it("adds the first-launch time to the existing alert instead of sending a second one", async () => {
    await reset();
    await as(MEMBER, () => record(DEV_A, "installed"));
    expect((await inbox(ADMIN_ID))[0].data.first_launch_at).toBeNull();
    await as(MEMBER, () => record(DEV_A, "launched"));
    await as(MEMBER, () => record(DEV_A, "launched")); // a later launch must not move the first-launch time
    const [row] = await q<{ status: string; first_launch_at: string; last_active_at: string }>(`select status, first_launch_at, last_active_at from app_installs`);
    expect(row.status).toBe("launched");
    const n = await inbox(ADMIN_ID);
    expect(n).toHaveLength(1);
    expect(new Date(n[0].data.first_launch_at as string).toISOString()).toBe(new Date(row.first_launch_at).toISOString());
    await as(MEMBER, () => record(DEV_A, "active"));
    expect((await q<{ first_launch_at: string }>(`select first_launch_at from app_installs`))[0].first_launch_at).toEqual(row.first_launch_at);
  });

  it("detects an iOS home-screen install from its first standalone launch", async () => {
    await reset();
    const r = await as(MEMBER, () => record(DEV_A, "launched", { platform: "ios", browser: "Safari", source: "home_screen" }));
    expect(r.created).toBe(true);
    expect(r.message).toBe("Junaid Shaikh has added the NAFA CRM app to the home screen of an iPhone/iPad device.");
    expect(await q(`select platform, source, status, first_launch_at is not null as launched from app_installs`)).toEqual([{ platform: "ios", source: "home_screen", status: "launched", launched: true }]);
  });

  it("supports several devices per user and says so in the alert", async () => {
    await reset();
    await as(MEMBER, () => record(DEV_A, "installed", { platform: "android" }));
    const second = await as(MEMBER, () => record(DEV_B, "installed", { platform: "windows", browser: "Edge" }));
    expect(second.created).toBe(true);
    expect(second.message).toContain("(device no. 2 for this user)");
    expect(await q(`select * from app_installs where user_id = $1`, [MEMBER])).toHaveLength(2);
    expect(await inbox(ADMIN_ID)).toHaveLength(2);
    // the same device id used by two different people is two separate installations
    await as(OTHER, () => record(DEV_A, "installed"));
    expect(await q(`select * from app_installs`)).toHaveLength(3);
  });

  it("honours the alert settings: off, extra recipients and email", async () => {
    await reset();
    await db.exec(`update install_alert_settings set enabled = false`);
    const off = await as(MEMBER, () => record(DEV_A, "installed"));
    expect(off.created).toBe(true); // still recorded for analytics
    expect(await inbox(ADMIN_ID)).toHaveLength(0);

    await reset();
    await db.exec(`update install_alert_settings set extra_recipients = array['${OTHER}']::uuid[], email_enabled = true, alert_emails = array['boss@nafa.test']`);
    const on = await as(MEMBER, () => record(DEV_A, "installed"));
    expect(on.email_to).toEqual(["boss@nafa.test"]);
    expect(await inbox(OTHER)).toHaveLength(1);
    expect(await inbox(ADMIN_ID)).toHaveLength(1);
    // an admin installing the app is not told about their own installation
    await as(ADMIN2, () => record(DEV_B, "installed"));
    expect((await inbox(ADMIN2)).map((n) => n.data.user_name)).toEqual(["Junaid Shaikh"]); // only the member's alert, none for their own install
    expect(await inbox(ADMIN_ID)).toHaveLength(2);
  });

  it("rejects bad input and callers without a profile", async () => {
    await expect(as(MEMBER, () => record(DEV_A, "bogus"))).rejects.toThrow(/INVALID_EVENT/);
    await expect(as(MEMBER, () => record("short", "installed"))).rejects.toThrow(/INVALID_DEVICE/);
    await expect(as(OUTSIDER_ID, () => record(DEV_A, "installed"))).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(as(null, () => record(DEV_A, "installed"))).rejects.toThrow();
    // unknown platform text falls back to "other"
    await reset();
    await as(MEMBER, () => record(DEV_A, "installed", { platform: "templeos" }));
    expect((await q<{ platform: string }>(`select platform from app_installs`))[0].platform).toBe("other");
  });
});

describe("access control", () => {
  it("lets only administrators read installation analytics and settings", async () => {
    await reset();
    await as(MEMBER, () => record(DEV_A, "installed"));
    expect(await as(ADMIN_ID, () => q(`select * from app_install_list`))).toHaveLength(1);
    expect(await as(ADMIN_ID, () => q(`select * from install_alert_settings`))).toHaveLength(1);
    for (const id of [MEMBER, OTHER]) {
      expect(await as(id, () => q(`select * from app_installs`))).toHaveLength(0);
      expect(await as(id, () => q(`select * from app_install_list`))).toHaveLength(0);
      expect(await as(id, () => q(`select * from install_alert_settings`))).toHaveLength(0);
    }
    await as(MEMBER, async () => {
      await q(`update install_alert_settings set enabled = false`); // RLS filters to zero rows
    });
    expect((await q<{ enabled: boolean }>(`select enabled from install_alert_settings`))[0].enabled).toBe(true);
    await expect(as(MEMBER, () => q(`insert into app_installs (user_id, device_id, platform, source) values ($1,'x'.repeat(1),'android','pwa')`.replace("'x'.repeat(1)", "'cccccccccccccccc'"), [MEMBER]))).rejects.toThrow();
  });

  it("keeps notifications private and lets a user only mark their own as read", async () => {
    await reset();
    await as(MEMBER, () => record(DEV_A, "installed"));
    const mine = await as(ADMIN_ID, () => q<{ id: string }>(`select id from notifications`));
    // another user cannot see or touch it
    expect(await as(ADMIN2, () => q(`select * from notifications where id = $1`, [mine[0].id]))).toHaveLength(0); // each admin has their own copy
    expect(await as(OTHER, () => q(`select * from notifications`))).toHaveLength(0);
    await as(OTHER, () => q(`update notifications set read_at = now()`));
    expect((await inbox(ADMIN_ID))[0].read_at).toBeNull();
    // the owner can mark read, but cannot rewrite the content or fabricate notifications
    await as(ADMIN_ID, () => q(`update notifications set read_at = now()`));
    expect((await inbox(ADMIN_ID))[0].read_at).not.toBeNull();
    await expect(as(ADMIN_ID, () => q(`update notifications set title = 'hacked'`))).rejects.toThrow();
    await expect(as(ADMIN_ID, () => q(`insert into notifications (user_id, type, title) values ($1,'x','fake')`, [ADMIN_ID]))).rejects.toThrow();
    await expect(as(ADMIN_ID, () => q(`delete from notifications`))).rejects.toThrow();
  });
});
