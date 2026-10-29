import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function fail(error: string, fieldErrors?: Record<string, string>, code?: string): { ok: false; error: string; fieldErrors?: Record<string, string>; code?: string } {
  return { ok: false, error, fieldErrors, code };
}

export function refresh(paths: string[]) {
  for (const p of paths) revalidatePath(p, p === "/" ? "page" : undefined);
}

export function friendlyDbError(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "You do not have permission to do that.";
  if (error.code === "23514" && error.message.includes("lost_reason")) return "A lost reason is required.";
  if (error.code === "23503") return "A linked record could not be found.";
  return "The database rejected this change. Please check the values and try again.";
}

export type { ActionResult };
