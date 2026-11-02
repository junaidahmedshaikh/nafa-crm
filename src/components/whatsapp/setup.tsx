/** Shown instead of a page when the WhatsApp migration has not been run yet. */
export function SetupNeeded({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft p-5 text-sm text-warning" role="alert">
      <p className="font-semibold">WhatsApp is not set up yet</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}

/** Pages call this around data loading so a missing migration shows a clear message instead of a generic error. */
export async function guarded<T>(load: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await load() };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("not set up")) return { ok: false, message };
    throw e;
  }
}
