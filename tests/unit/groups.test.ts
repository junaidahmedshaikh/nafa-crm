import { describe, expect, it } from "vitest";
import { applyFilters, classifyContacts, groupMembers, type ContactRow, type GroupDef } from "@/lib/email/audience";

const row = (id: string, o: Partial<ContactRow> = {}): ContactRow => ({
  id, fullName: `C ${id}`, email: `${id}@x.com`, emailStatus: "valid", designation: null, companyName: "Co", industry: "Wedding planning", city: "Mumbai", state: "MH",
  website: null, categories: [], lastContactAt: null, leadStatuses: [], leadPriorities: [], ...o,
});
const rows = [row("a"), row("b"), row("c", { city: "Delhi" }), row("d", { emailStatus: "unsubscribed" }), row("e", { industry: "Banking" })];

describe("recipient groups", () => {
  it("static groups contain exactly the assigned contacts", () => {
    const g: GroupDef = { id: "g1", name: "S", group_type: "static", filter_conditions: {}, status: "active" };
    const map = new Map([["g1", new Set(["a", "c", "zzz"])]]);
    expect(groupMembers(g, rows, map).map((r) => r.id)).toEqual(["a", "c"]);   // unknown ids ignored
  });

  it("dynamic groups follow their conditions and update as contacts change", () => {
    const g: GroupDef = { id: "g2", name: "D", group_type: "dynamic", filter_conditions: { industries: ["wedding"], cities: ["mumbai"], emailVerifiedOnly: true }, status: "active" };
    expect(groupMembers(g, rows, new Map()).map((r) => r.id)).toEqual(["a", "b"]);
    const changed = rows.map((r) => (r.id === "c" ? { ...r, city: "Mumbai" } : r));          // Delhi -> Mumbai
    expect(groupMembers(g, changed, new Map()).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("a contact in several selected groups is emailed once", () => {
    const g1 = new Set(["a", "b"]);
    const g2 = new Set(["b", "c"]);
    const union = new Set([...g1, ...g2]);
    const matched = applyFilters(rows, { groupIds: ["g1", "g2"] }, new Date(), new Set(), union);
    expect(matched.map((r) => r.id)).toEqual(["a", "b", "c"]);
    const dupEmail = [...matched, { ...row("b2"), email: "B@x.com" }];                     // same address on another contact record
    const out = classifyContacts(dupEmail, new Map());
    expect(out.eligible).toHaveLength(3);
    expect(out.excluded.map((e) => e.reason)).toEqual(["duplicate"]);
  });

  it("never emails unsubscribed or suppressed members, whichever group they are in", () => {
    const out = classifyContacts(rows, new Map([["e@x.com", "bounced"]]));
    expect(out.excluded.map((e) => e.reason).sort()).toEqual(["bounced", "unsubscribed"]);
  });

  it("group selection combines with other filters", () => {
    const members = new Set(["a", "c"]);
    expect(applyFilters(rows, { groupIds: ["g"], cities: ["delhi"] }, new Date(), new Set(), members).map((r) => r.id)).toEqual(["c"]);
    expect(applyFilters(rows, { groupIds: ["g"] }, new Date(), new Set(), undefined)).toHaveLength(0);   // unknown/empty groups match nobody
  });
});
