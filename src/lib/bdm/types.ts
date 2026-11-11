import type { LeadPriority, LeadSource, LeadStatus, ServiceCategory } from "@/lib/constants";

/**
 * Facts read from the CRM. Everything the engine reports is derived from these rows;
 * anything it cannot know is reported as missing, never guessed.
 */
export type LeadFact = {
  id: string;
  number: number;
  title: string;
  companyId: string | null;
  companyName: string | null;
  industry: string | null;
  contactName: string | null;
  contactDesignation: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  source: LeadSource;
  serviceCategory: ServiceCategory;
  eventName: string | null;
  eventDate: string | null; // YYYY-MM-DD
  city: string | null;
  budget: number | null;
  expectedRevenue: number | null;
  status: LeadStatus;
  priority: LeadPriority;
  assignedTo: string | null;
  assignedName: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  closedAt: string | null;
};

export type FollowUpFact = { id: string; leadId: string; type: string; title: string; dueAt: string };

/** Subset of lead_activities relevant to engagement. */
export type ActivityFact = { leadId: string; type: string; createdAt: string };

export type DocFact = {
  kind: "quotation" | "proposal";
  id: string;
  number: string | null;
  leadId: string | null;
  companyName: string | null;
  status: string;
  sentAt: string | null;
  validUntil: string | null; // YYYY-MM-DD
  amount: number | null;
};

export type BdmSettingsFact = { inactiveDays: number; proposalFollowupDays: number };

export type BdmInput = {
  now: Date;
  settings: BdmSettingsFact;
  leads: LeadFact[]; // includes won/lost (history) — the engine filters open ones itself
  followUps: FollowUpFact[]; // pending only
  completedMeetings: { leadId: string; at: string }[];
  activities: ActivityFact[];
  docs: DocFact[];
};

export type Channel = "call" | "email" | "whatsapp" | "meeting" | "general_task";
export type RecKind = "prospect" | "proposal" | "reply" | "meeting" | "reconnect" | "general";

export type LeadRef = {
  leadId: string;
  leadNumber: number;
  company: string;
  contact: string | null;
  industry: string | null;
  city: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  assignedName: string | null;
  lastContactAt: string | null;
  daysSinceContact: number | null;
  value: number | null;
};

export type ProspectRec = LeadRef & {
  score: number;
  nextAction: string;
  reasons: string[];
  missing: string[];
  channel: Channel;
  service: { name: string; why: string } | null;
  segment: string | null;
};

export type DealTier = "high" | "medium" | "low" | "needs_data";
export type DealAssessment = LeadRef & {
  tier: DealTier;
  score: number | null;
  /** How complete the underlying CRM data is — NOT a probability of closing. */
  dataConfidence: "high" | "medium" | "low";
  atRisk: boolean;
  needsManagement: boolean;
  reasons: string[];
  riskReasons: string[];
  missing: string[];
  expectedCloseDate: string | null;
};

export type ProposalIntel = LeadRef & {
  docKind: "quotation" | "proposal";
  docId: string;
  docNumber: string | null;
  sentAt: string | null;
  daysSinceSent: number | null;
  validUntil: string | null;
  daysToExpiry: number | null;
  amount: number | null;
  needsFollowUp: boolean;
  expiringSoon: boolean;
  expired: boolean;
  interestShown: boolean;
  highConversion: boolean;
  needsNegotiation: boolean;
  nextAction: string;
  reasons: string[];
  channel: Channel;
};

export type PlanItem = {
  dedupeKey: string;
  kind: RecKind;
  leadId: string | null;
  quotationId: string | null;
  proposalId: string | null;
  title: string;
  action: string;
  reason: string;
  channel: Channel | null;
  suggestedService: string | null;
  priority: number;
};

export type Metrics = {
  activeLeads: number;
  newLeads: number;
  hotProspects: number;
  followUpsToday: number;
  overdue: number;
  pendingProposals: number;
  highPotentialDeals: number;
  dealsAtRisk: number;
  meetings: number;
  awaitingResponse: number;
  notContacted: number;
  inactive: number;
};

export type MeetingItem = { followUpId: string; at: string; title: string } & LeadRef;
export type FollowUpItem = { followUpId: string; dueAt: string; title: string; type: string } & LeadRef;

export type BriefingData = {
  generatedAt: string;
  istDate: string;
  metrics: Metrics;
  newLeads: LeadRef[];
  highPriority: LeadRef[];
  notContacted: LeadRef[];
  followUpsToday: FollowUpItem[];
  overdueFollowUps: FollowUpItem[];
  awaitingResponse: (LeadRef & { repliedAt: string })[];
  inactive: LeadRef[];
  meetings: MeetingItem[];
  prospects: ProspectRec[];
  proposals: ProposalIntel[];
  deals: DealAssessment[];
  industries: { industry: string; openLeads: number; value: number }[];
  actionPlan: PlanItem[]; // top 10 of `recommendations`
  recommendations: PlanItem[]; // every item stored as a recommendation (one per lead)
  dataNotes: string[];
};
