"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { deleteContacts } from "@/lib/actions/recipient-groups";

/** Administrator-only permanent delete. Contacts with leads cannot be deleted (archive them). */
export function DeleteContactButton({ id, name, leadCount }: { id: string; name: string; leadCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="danger-outline" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" aria-hidden />Delete</Button>
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} pending={pending} confirmLabel="Delete permanently"
        title="Delete contact?"
        description={leadCount > 0 ? `“${name}” has ${leadCount} lead(s), so it cannot be deleted. Archive it instead.` : `“${name}” will be deleted for good, including its recipient-group assignments. This cannot be undone.`}
        onConfirm={() => start(async () => {
          const r = await deleteContacts({ ids: [id] });
          if (r.ok) { toast.success("Contact deleted"); router.push("/contacts"); router.refresh(); } else { toast.error(r.error); setOpen(false); }
        })}
      />
    </>
  );
}
