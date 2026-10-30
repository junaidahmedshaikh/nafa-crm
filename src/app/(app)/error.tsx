"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/layout";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={AlertTriangle}
        title="This page could not be loaded"
        description={
          error.message.includes("Supabase is not configured") || error.message.includes("Document settings") || process.env.NODE_ENV !== "production"
            ? error.message
            : "Something went wrong while loading your data. Check your connection and try again."
        }
        action={<Button variant="primary" onClick={reset}>Try again</Button>}
      />
      {error.digest && <p className="pb-4 text-center text-xs text-muted">Reference: {error.digest}</p>}
    </Card>
  );
}
