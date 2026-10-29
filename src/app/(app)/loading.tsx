export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" role="status" aria-label="Loading">
      <div className="h-7 w-48 rounded bg-black/10" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-lg bg-black/5" />)}
      </div>
      <div className="h-72 rounded-lg bg-black/5" />
    </div>
  );
}
