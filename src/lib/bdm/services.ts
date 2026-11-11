import type { ServiceCategory } from "@/lib/constants";

/** NAFA Events & Activations service catalogue (used for recommendations and as AI context). */
export const NAFA_SERVICES = [
  "Corporate Event Management",
  "Brand Activations",
  "BTL Marketing",
  "Experiential Marketing",
  "Brand Promotions",
  "Exhibitions and Trade Shows",
  "Mall and Retail Activations",
  "Roadshows and Outdoor Promotions",
  "Wedding and Social Events",
  "Event Production and Management",
  "Staffing, Fabrication and Logistics",
] as const;

const CATEGORY_SERVICE: Partial<Record<ServiceCategory, string>> = {
  event_management: "Event Production and Management",
  brand_activation: "Brand Activations",
  btl_marketing: "BTL Marketing",
  experiential_marketing: "Experiential Marketing",
  corporate_event: "Corporate Event Management",
  exhibition: "Exhibitions and Trade Shows",
  wedding_private_event: "Wedding and Social Events",
};

type Rule = { segment: string; test: RegExp; service: string; why: string };

/** Ordered: first match wins. Matched against industry + company name + lead title/event name. */
const RULES: Rule[] = [
  { segment: "Wedding planner", test: /wedding|bridal|shaadi|matrimon/i, service: "Wedding and Social Events", why: "wedding / social-events business" },
  { segment: "Hotel / banquet venue", test: /hotel|banquet|resort|hospitality|venue/i, service: "Event Production and Management", why: "venues need production and décor partners" },
  { segment: "MICE company", test: /\bmice\b|incentive|conference|convention/i, service: "Staffing, Fabrication and Logistics", why: "MICE firms outsource fabrication, staffing and logistics" },
  { segment: "Event management agency", test: /event(s)? (management|agency|company|planner)|events?\b.*(pvt|ltd|llp)|entertainment/i, service: "Staffing, Fabrication and Logistics", why: "event agencies subcontract execution capacity" },
  { segment: "Digital marketing agency", test: /digital|seo|social media|performance marketing/i, service: "Experiential Marketing", why: "digital agencies need offline/experiential execution partners" },
  { segment: "Advertising agency", test: /advertis|creative agency|media agency|\bbtl\b|\batl\b|branding agency|communications/i, service: "BTL Marketing", why: "ad agencies subcontract BTL and activation execution" },
  { segment: "Production / activation agency", test: /production|activation|promotion/i, service: "Staffing, Fabrication and Logistics", why: "activation agencies need staffing and fabrication capacity" },
  { segment: "Exhibitor / trade show", test: /exhibit|expo|trade ?show|fair/i, service: "Exhibitions and Trade Shows", why: "exhibition-related business" },
  { segment: "Retail brand", test: /retail|mall|fmcg|consumer|apparel|fashion|lifestyle|cosmetic|beauty|food|beverage|restaurant/i, service: "Mall and Retail Activations", why: "retail / consumer brand — in-store and mall activations" },
  { segment: "Automobile / outdoor", test: /auto|motor|vehicle|tyre|two.?wheeler/i, service: "Roadshows and Outdoor Promotions", why: "automotive brands run roadshows and outdoor promotions" },
  { segment: "Corporate marketing / brand team", test: /brand|marketing/i, service: "Brand Activations", why: "brand / marketing team" },
  { segment: "Corporate HR / admin", test: /\bhr\b|human resource|admin|people|culture|employee/i, service: "Corporate Event Management", why: "HR / admin teams buy employee engagement and corporate events" },
  { segment: "Corporate", test: /bank|financ|insur|pharma|health|software|\bit\b|technolog|telecom|manufactur|engineer|real estate|consult|education|corporate/i, service: "Corporate Event Management", why: "corporate organisation — conferences, offsites, launches" },
];

export function classifySegment(p: { industry?: string | null; companyName?: string | null; title?: string | null }): string | null {
  const hay = [p.industry, p.companyName, p.title].filter(Boolean).join(" | ");
  if (!hay) return null;
  return RULES.find((r) => r.test.test(hay))?.segment ?? null;
}

/** Most relevant NAFA service for a prospect. Returns null when the profile has nothing to go on. */
export function recommendService(p: {
  serviceCategory: ServiceCategory;
  industry?: string | null;
  companyName?: string | null;
  title?: string | null;
  eventName?: string | null;
}): { name: string; why: string } | null {
  const direct = CATEGORY_SERVICE[p.serviceCategory];
  if (direct) return { name: direct, why: "matches the service category recorded on the lead" };
  const hay = [p.industry, p.companyName, p.title, p.eventName].filter(Boolean).join(" | ");
  const rule = RULES.find((r) => r.test.test(hay));
  return rule ? { name: rule.service, why: rule.why } : null;
}
