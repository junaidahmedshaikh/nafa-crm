import type {
  ActivityType, FollowUpStatus, FollowUpType, LeadPriority, LeadSource, LeadStatus, ServiceCategory,
} from "@/lib/constants";

/** Hand-maintained row types mirroring supabase/migrations (no generated types in Phase 1). */

export type Profile = {
  id: string;
  full_name: string;
  role: "admin" | "member";
  is_active: boolean;
};

export type BusinessSettings = {
  business_name: string;
  website: string;
  business_email: string | null;
  default_country_code: string;
  currency: "INR";
  default_follow_up_days: number;
  default_follow_up_time: string; // "HH:MM:SS"
  default_follow_up_type: FollowUpType;
};

export type Company = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Contact = {
  id: string;
  company_id: string | null;
  full_name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  communication_notes: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Row of the public.lead_list view. */
export type Lead = {
  id: string;
  lead_number: number;
  title: string;
  company_id: string | null;
  contact_id: string | null;
  source: LeadSource;
  service_category: ServiceCategory;
  event_name: string | null;
  event_date: string | null;
  city: string | null;
  venue: string | null;
  budget_inr: number | null;
  expected_revenue_inr: number | null;
  status: LeadStatus;
  priority: LeadPriority;
  assigned_to: string | null;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
  notes: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  company_name: string | null;
  company_website: string | null;
  contact_name: string | null;
  contact_designation: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  assigned_name: string | null;
};

export type FollowUp = {
  id: string;
  lead_id: string;
  title: string;
  due_at: string;
  type: FollowUpType;
  notes: string | null;
  status: FollowUpStatus;
  completed_at: string | null;
  created_at: string;
};

/** Row of the public.follow_up_list view (follow-ups of non-archived leads). */
export type FollowUpRow = FollowUp & {
  lead_number: number;
  lead_title: string;
  lead_status: LeadStatus;
  company_name: string | null;
};

export type CompanyRow = Company & { contact_count: number; lead_count: number };
export type ContactRow = Contact & { company_name: string | null; lead_count: number };

export type LeadActivity = {
  id: string;
  lead_id: string;
  type: ActivityType;
  summary: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  author: { full_name: string } | null;
};

/** Result of every server action. */
export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      /** Machine-readable reason when the UI must react differently (e.g. ask for confirmation). */
      code?: string;
      /** Potential duplicates the user must resolve before the action can proceed. */
      duplicates?: DuplicateReport;
    };

export type DuplicateMatch = { id: string; label: string; detail: string; href: string };
export type DuplicateReport = {
  companies: DuplicateMatch[];
  contacts: DuplicateMatch[];
  leads: DuplicateMatch[];
};
