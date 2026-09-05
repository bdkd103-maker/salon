import { z } from "zod";

export const salonScheduleFields = {
  openingTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm").optional(),
  closingTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm").optional(),
  workingDays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]))
    .max(7).transform(days => [...new Set(days)]).optional(),
  timeZone: z.string().trim().min(1).max(100).refine(value => {
    // Named IANA zones only; numeric UTC offsets are not salon timezones.
    if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA timezone").optional(),
};
