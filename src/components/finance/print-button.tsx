"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, where "Save as PDF" produces the PDF copy of the report on screen. */
export function PrintButton({ label = "Print / Save PDF" }: { label?: string }) {
  return <Button onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden />{label}</Button>;
}
