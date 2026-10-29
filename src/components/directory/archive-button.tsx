"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { setCompanyArchived, setContactArchived } from "@/lib/actions/directory";

export function ArchiveButton({ kind, id, name, archived }: { kind: "company" | "contact"; id: string; name: string; archived: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(next: boolean) {
    startTransition(async () => {
      const res = await (kind === "company" ? setCompanyArchived : setContactArchived)(id, next);
      if (res.ok) {
        toast.success(next ? `${name} archived` : `${name} restored`);
        setOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  if (archived) {
    return <Button onClick={() => run(false)} loading={pending}><ArchiveRestore className="h-4 w-4" aria-hidden />Restore</Button>;
  }
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}><Archive className="h-4 w-4" aria-hidden />Archive</Button>
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} onConfirm={() => run(true)} pending={pending}
        title={`Archive ${kind}?`}
        description={`“${name}” will be hidden from lists and search. Linked leads and history are kept. You can restore it from the archived view.`}
        confirmLabel="Archive"
      />
    </>
  );
}
