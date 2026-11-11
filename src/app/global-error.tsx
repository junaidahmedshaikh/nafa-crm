"use client";

/** Last-resort error screen (root layout failures). Shows no technical detail; the cause is in the server logs. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: "#666" }}>The page could not be loaded. Your data is safe.</p>
          <button onClick={reset} style={{ padding: "8px 16px", cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
