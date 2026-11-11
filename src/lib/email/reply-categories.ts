// Client-safe reply category constants (no server imports).
export const REPLY_CATEGORIES = ["interested", "not_interested", "request_for_details", "meeting_request", "price_enquiry", "follow_up_later", "out_of_office", "unsubscribe"] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];
export const REPLY_LABEL: Record<ReplyCategory, string> = {
  interested: "Interested", not_interested: "Not interested", request_for_details: "Request for details", meeting_request: "Meeting request",
  price_enquiry: "Price enquiry", follow_up_later: "Follow up later", out_of_office: "Out of office", unsubscribe: "Unsubscribe",
};
export const POSITIVE: ReplyCategory[] = ["interested", "request_for_details", "meeting_request", "price_enquiry"];
