/** Domain enums. Values mirror the Postgres enums in supabase/migrations. */

function options<const T extends readonly string[]>(values: T, labels: Record<T[number], string>) {
  return values.map((value) => ({ value, label: labels[value as T[number]] }));
}

export const LEAD_STATUSES = [
  "new", "contacted", "qualified", "brief_received",
  "proposal_in_progress", "proposal_sent", "negotiation", "won", "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", brief_received: "Brief Received",
  proposal_in_progress: "Proposal in Progress", proposal_sent: "Proposal Sent",
  negotiation: "Negotiation", won: "Won", lost: "Lost",
};
export const LEAD_STATUS_OPTIONS = options(LEAD_STATUSES, LEAD_STATUS_LABELS);

/** Statuses in which a lead is still being worked. */
export const OPEN_STATUSES: LeadStatus[] = [
  "new", "contacted", "qualified", "brief_received", "proposal_in_progress", "proposal_sent", "negotiation",
];
/** "Qualified opportunities": past first contact, not yet closed. */
export const QUALIFIED_STATUSES: LeadStatus[] = [
  "qualified", "brief_received", "proposal_in_progress", "proposal_sent", "negotiation",
];
/** Quotations / proposals that are being prepared or are awaiting a client decision. */
export const PROPOSAL_STATUSES: LeadStatus[] = ["proposal_in_progress", "proposal_sent"];

export const LEAD_PRIORITIES = ["high", "medium", "low"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];
export const LEAD_PRIORITY_LABELS: Record<LeadPriority, string> = { high: "High", medium: "Medium", low: "Low" };
export const LEAD_PRIORITY_OPTIONS = options(LEAD_PRIORITIES, LEAD_PRIORITY_LABELS);

export const LEAD_SOURCES = ["website", "whatsapp", "email", "referral", "linkedin", "outbound", "existing_client", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Website", whatsapp: "WhatsApp", email: "Email", referral: "Referral",
  linkedin: "LinkedIn", outbound: "Outbound", existing_client: "Existing Client", other: "Other",
};
export const LEAD_SOURCE_OPTIONS = options(LEAD_SOURCES, LEAD_SOURCE_LABELS);

export const SERVICE_CATEGORIES = [
  "event_management", "brand_activation", "btl_marketing", "experiential_marketing",
  "corporate_event", "exhibition", "wedding_private_event", "other",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  event_management: "Event Management", brand_activation: "Brand Activation", btl_marketing: "BTL Marketing",
  experiential_marketing: "Experiential Marketing", corporate_event: "Corporate Event", exhibition: "Exhibition",
  wedding_private_event: "Wedding / Private Event", other: "Other",
};
export const SERVICE_CATEGORY_OPTIONS = options(SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS);

export const FOLLOW_UP_TYPES = ["call", "email", "whatsapp", "meeting", "general_task"] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];
export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  call: "Call", email: "Email", whatsapp: "WhatsApp", meeting: "Meeting", general_task: "General Task",
};
export const FOLLOW_UP_TYPE_OPTIONS = options(FOLLOW_UP_TYPES, FOLLOW_UP_TYPE_LABELS);

export const FOLLOW_UP_STATUSES = ["pending", "completed", "cancelled"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  pending: "Pending", completed: "Completed", cancelled: "Cancelled",
};

export const ACTIVITY_TYPES = [
  "created", "updated", "status_changed", "won", "lost", "note",
  "follow_up_scheduled", "follow_up_completed", "follow_up_rescheduled", "follow_up_cancelled",
  "archived", "restored",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const PAGE_SIZE = 25;
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";
