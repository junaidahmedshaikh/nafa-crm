import { z } from "zod";
import {
  FOLLOW_UP_TYPES, LEAD_PRIORITIES, LEAD_SOURCES, LEAD_STATUSES, SERVICE_CATEGORIES,
} from "@/lib/constants";
import {
  optDate, optDateTime, optEmail, optMoney, optPhone, optText, optUuid, optWebsite, reqDateTime, reqText,
} from "./common";

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
export const leadSchema = (cc = "+91") =>
  z
    .object({
      title: reqText("Lead title"),
      company_name: optText(200),
      website: optWebsite,
      contact_name: optText(200),
      designation: optText(120),
      email: optEmail,
      phone: optPhone(cc),
      whatsapp: optPhone(cc),
      source: z.enum(LEAD_SOURCES),
      service_category: z.enum(SERVICE_CATEGORIES),
      event_name: optText(200),
      event_date: optDate,
      city: optText(100),
      venue: optText(200),
      budget_inr: optMoney,
      expected_revenue_inr: optMoney,
      status: z.enum(LEAD_STATUSES),
      priority: z.enum(LEAD_PRIORITIES),
      assigned_to: optUuid,
      last_contact_date: optDate,
      notes: optText(5000),
      lost_reason: optText(500),
      /** Create only: schedules a first follow-up task. */
      first_follow_up_at: optDateTime,
    })
    .superRefine((v, ctx) => {
      if (v.status === "lost" && !v.lost_reason) {
        ctx.addIssue({ code: "custom", path: ["lost_reason"], message: "A lost reason is required" });
      }
      if (!v.company_name && !v.contact_name && !v.email && !v.phone) {
        ctx.addIssue({ code: "custom", path: ["company_name"], message: "Enter a company or a contact person" });
      }
      if (v.contact_name === null && (v.email || v.phone || v.whatsapp || v.designation)) {
        ctx.addIssue({ code: "custom", path: ["contact_name"], message: "Contact person name is required when contact details are given" });
      }
    });
export type LeadFormInput = z.input<ReturnType<typeof leadSchema>>;
export type LeadFormData = z.output<ReturnType<typeof leadSchema>>;

export const statusChangeSchema = z
  .object({ status: z.enum(LEAD_STATUSES), lost_reason: optText(500) })
  .superRefine((v, ctx) => {
    if (v.status === "lost" && !v.lost_reason) {
      ctx.addIssue({ code: "custom", path: ["lost_reason"], message: "A lost reason is required" });
    }
  });

export const noteSchema = z.object({ note: reqText("Note", 5000) });

// ---------------------------------------------------------------------------
// Companies / contacts
// ---------------------------------------------------------------------------
export const companySchema = z.object({
  name: reqText("Company name"),
  website: optWebsite,
  industry: optText(120),
  city: optText(100),
  address: optText(500),
  notes: optText(5000),
});
export type CompanyFormInput = z.input<typeof companySchema>;
export type CompanyFormData = z.output<typeof companySchema>;

export const contactSchema = (cc = "+91") =>
  z.object({
    full_name: reqText("Full name"),
    company_id: optUuid,
    designation: optText(120),
    email: optEmail,
    phone: optPhone(cc),
    whatsapp: optPhone(cc),
    communication_notes: optText(1000),
    notes: optText(5000),
  });
export type ContactFormInput = z.input<ReturnType<typeof contactSchema>>;
export type ContactFormData = z.output<ReturnType<typeof contactSchema>>;

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------
export const followUpSchema = z.object({
  title: reqText("Task title"),
  due_at: reqDateTime("Due date and time"),
  type: z.enum(FOLLOW_UP_TYPES),
  notes: optText(2000),
});
export type FollowUpFormInput = z.input<typeof followUpSchema>;
export type FollowUpFormData = z.output<typeof followUpSchema>;

export const rescheduleSchema = z.object({ due_at: reqDateTime("Due date and time") });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const settingsSchema = z.object({
  business_name: reqText("Business name"),
  website: optWebsite,
  business_email: optEmail,
  default_country_code: z.string().trim().regex(/^\+[0-9]{1,4}$/, "Use the format +91"),
  default_follow_up_days: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, "Enter a number of days between 0 and 365")
    .transform(Number)
    .refine((n) => n >= 0 && n <= 365, "Enter a number of days between 0 and 365"),
  default_follow_up_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  default_follow_up_type: z.enum(FOLLOW_UP_TYPES),
});
export type SettingsFormInput = z.input<typeof settingsSchema>;
export type SettingsFormData = z.output<typeof settingsSchema>;

export const profileSchema = z.object({ full_name: reqText("Full name", 120) });
export type ProfileFormInput = z.input<typeof profileSchema>;
