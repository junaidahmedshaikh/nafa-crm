import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

export const ADMIN_ID = "00000000-0000-0000-0000-0000000000a1";
export const OUTSIDER_ID = "00000000-0000-0000-0000-0000000000b2"; // authenticated but has no profile
export const INACTIVE_ID = "00000000-0000-0000-0000-0000000000c3";

/** Boots an in-process Postgres with a minimal stand-in for Supabase's auth schema and roles,
 *  then applies the real migrations from supabase/migrations. */
export async function createDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const dir = path.resolve(__dirname, "../../supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN_ID}', 'owner@example.com'), ('${OUTSIDER_ID}', 'rando@example.com'), ('${INACTIVE_ID}', 'old@example.com');
    insert into public.profiles (id, full_name, role) values ('${ADMIN_ID}', 'Owner', 'admin');
    insert into public.profiles (id, full_name, role, is_active) values ('${INACTIVE_ID}', 'Ex Member', 'member', false);
  `);
  return db;
}

/** Runs fn as an authenticated (or anon) database user, the way PostgREST would. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
