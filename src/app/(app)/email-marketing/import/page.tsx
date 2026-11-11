import { redirect } from "next/navigation";

// The importer now lives with the other Contacts tools; keep old links working.
export default function ImportRedirect() {
  redirect("/contacts/import");
}
