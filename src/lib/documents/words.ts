import Decimal from "decimal.js";

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/** Whole number in the Indian system (crore / lakh / thousand). */
export function integerToIndianWords(value: number): string {
  if (value === 0) return "Zero";
  const units: [number, string][] = [
    [10_000_000, "Crore"], [100_000, "Lakh"], [1_000, "Thousand"],
  ];
  let rest = value;
  const parts: string[] = [];
  for (const [size, name] of units) {
    if (rest >= size) {
      const q = Math.floor(rest / size);
      parts.push(`${integerToIndianWords(q)} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

/** e.g. 125000.5 → "Rupees One Lakh Twenty-Five Thousand and Fifty Paise Only". */
export function amountInWords(amount: number | string): string {
  const d = new Decimal(String(amount)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (d.isNegative()) return `Minus ${amountInWords(d.abs().toString())}`;
  const rupees = d.floor();
  const paise = d.minus(rupees).mul(100).toNumber();
  const rupeeWords = `Rupees ${integerToIndianWords(rupees.toNumber())}`;
  return paise > 0 ? `${rupeeWords} and ${integerToIndianWords(paise)} Paise Only` : `${rupeeWords} Only`;
}
