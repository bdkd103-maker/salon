import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/** Only for new registrations, never a bulk rewrite of existing numbers. */
export function normalizeGermanPhone(value: string): string {
  const trimmed = value.trim();
  if (!/^[+0-9() .\/-]+$/.test(trimmed)) throw new Error("Enter a valid German phone number.");
  let number = trimmed.replace(/[() .\/-]/g, "");
  if (number.startsWith("00")) number = "+" + number.slice(2);
  if (number.startsWith("+") && !number.startsWith("+49")) throw new Error("Only German (+49) phone numbers are supported.");
  if (!number.startsWith("+")) number = "+49" + number.replace(/^0/, "");
  if (!/^\+49[1-9]\d+$/.test(number)) throw new Error("Enter a valid German phone number.");
  const parsed = parsePhoneNumberFromString(number);
  if (!parsed || parsed.country !== "DE" || !parsed.isValid()) throw new Error("Enter a valid German phone number.");
  return parsed.number;
}
