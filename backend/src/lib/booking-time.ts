export type BookingDayWindow = {
  start: string;
  end: string;
};

export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const zoneName = map.timeZoneName || "GMT";
  const match = zoneName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);

  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

export function formatInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const value = formatter.format(date);
  return value.replace(" ", "T");
}

export function parseWallClockInTimeZone(dateTimeLocal: string, timeZone: string): Date {
  const [datePart, timePart] = dateTimeLocal.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second = 0] = timePart.split(":").map(Number);
  const utcLike = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcLike, timeZone);
  return new Date(utcLike.getTime() - offsetMinutes * 60_000);
}

export function toMinutes(value: string): number {
  const [hours, minutes = "0"] = value.split(":").map((part) => Number(part || 0));
  const minuteValue = Number(minutes ?? 0);
  return hours * 60 + minuteValue;
}

export function isWeekend(date: Date, timeZone: string): boolean {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date) === "Sat"
    || new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date) === "Sun";
}

export function isHoliday(date: Date, timeZone: string): boolean {
  const short = formatInTimeZone(date, timeZone).slice(0, 10);
  const germanHolidays = [
    "2026-01-01",
    "2026-01-06",
    "2026-04-03",
    "2026-05-01",
    "2026-05-14",
    "2026-05-25",
    "2026-06-04",
    "2026-08-15",
    "2026-09-20",
    "2026-10-03",
    "2026-11-01",
    "2026-12-25",
    "2026-12-26",
  ];
  return germanHolidays.includes(short);
}

export function isWithinOperatingHours(
  startLocal: string,
  endLocal: string,
  timeZone: string,
  opening: string,
  closing: string,
): boolean {
  const start = parseWallClockInTimeZone(startLocal, timeZone);
  const end = parseWallClockInTimeZone(endLocal, timeZone);

  const startInZone = formatInTimeZone(start, timeZone).slice(11, 16);
  const endInZone = formatInTimeZone(end, timeZone).slice(11, 16);

  const openMinutes = toMinutes(opening);
  const closeMinutes = toMinutes(closing);
  const startMinutes = toMinutes(startInZone);
  const endMinutes = toMinutes(endInZone);

  if (closeMinutes <= openMinutes) {
    return startMinutes >= openMinutes || endMinutes <= closeMinutes;
  }

  return startMinutes >= openMinutes && endMinutes <= closeMinutes;
}
