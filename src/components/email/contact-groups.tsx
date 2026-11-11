"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GroupPicker, type GroupOption } from "@/components/email/group-picker";
import { Button } from "@/components/ui/button";
import { setContactGroups } from "@/lib/actions/recipient-groups";

/** Recipient groups on a contact profile. Changes apply to Recipient Groups and campaign selection immediately. */
export function ContactGroups({ contactId, groups, initial }: { contactId: string; groups: GroupOption[]; initial: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(initial);
  const dirty = value.slice().sort().join() !== initial.slice().sort().join();
  return (
    <div className="space-y-3 p-5">
      <GroupPicker groups={groups} value={value} onChange={setValue} />
      {dirty && (
        <Button variant="primary" size="sm" loading={pending} onClick={() => start(async () => { const r = await setContactGroups(contactId, value); if (r.ok) { toast.success("Groups updated"); router.refresh(); } else toast.error(r.error); })}>Save groups</Button>
      )}
    </div>
  );
}
