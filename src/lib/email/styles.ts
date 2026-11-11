export const WRITING_STYLES = {
  professional: "Professional corporate: formal, polished, respectful.",
  friendly: "Friendly and conversational: warm, natural, approachable.",
  luxury: "Premium and luxury: refined, elegant, understated confidence.",
  short: "Short and direct: under 90 words, one clear point, one call to action.",
  partnership: "Partnership-oriented: focuses on mutual benefit and collaboration.",
  persuasive: "Persuasive business development: benefit-led, confident, with a clear call to action.",
} as const;
export type WritingStyle = keyof typeof WRITING_STYLES;
