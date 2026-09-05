const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_INDEX = Object.fromEntries(DAY_KEYS.map((dayKey, index) => [dayKey, index])) as Record<SalonDayKey, number>;
const WEEKDAY_TO_KEY: Record<string, SalonDayKey> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

export const DEFAULT_SALON_TIME_ZONE = "Europe/Berlin";

export type SalonDayKey = (typeof DAY_KEYS)[number];

export type SalonInterval = {
  open: string;
  close: string;
  startMinutes: number;
  endMinutes: number;
  crossesMidnight: boolean;
};

export type SalonWeeklySchedule = Record<SalonDayKey, SalonInterval[]>;

export type SalonHoursShape = {
  isActive?: boolean | null;
  openingTime?: string | null;
  closingTime?: string | null;
  open?: string | null;
  close?: string | null;
  workingDays?: unknown;
  weeklyOpeningHours?: unknown;
  openingHours?: unknown;
  weeklyHours?: unknown;
  schedule?: unknown;
  timeZone?: string | null;
  timezone?: string | null;
  timezoneId?: string | null;
  location?: {
    timeZone?: string | null;
    timezone?: string | null;
  } | null;
};

export type SalonOperatingState = {
  key: "open" | "closed";
  isOpen: boolean;
  timeZone: string;
  reason: "inactive" | "missing-hours" | "within-hours" | "outside-hours";
  schedule: SalonWeeklySchedule;
  todayKey?: SalonDayKey;
  currentMinutes?: number;
  activeInterval?: SalonInterval | null;
  errors?: string[];
};

function isValidTimeZone(value: unknown): value is string {
  const candidate = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(candidate)) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveSalonTimeZone(salon: SalonHoursShape | null | undefined): string {
  const candidates = [
    salon?.timeZone,
    salon?.timezone,
    salon?.timezoneId,
    salon?.location?.timeZone,
    salon?.location?.timezone,
  ];
  for (const candidate of candidates) {
    if (isValidTimeZone(candidate)) return String(candidate).trim();
  }
  return "";
}

function normalizeDayKey(value: unknown): SalonDayKey | "" {
  const candidate = String(value || "").trim().toLowerCase() as SalonDayKey;
  return Object.prototype.hasOwnProperty.call(DAY_INDEX, candidate) ? candidate : "";
}

function getAdjacentDayKey(dayKey: SalonDayKey, offset: number): SalonDayKey {
  const index = DAY_INDEX[dayKey];
  return DAY_KEYS[(index + offset + DAY_KEYS.length) % DAY_KEYS.length];
}

function parseClockMinutes(value: unknown): number | null {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function getZonedNowParts(date: Date, timeZone: string): { dayKey: SalonDayKey; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const dayKey = WEEKDAY_TO_KEY[parts.weekday] || "mon";
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  return {
    dayKey,
    minutes: hour * 60 + minute,
  };
}

function parseIntervalSource(intervalSource: unknown): { open: string; close: string } | null {
  if (!intervalSource) return null;
  if (typeof intervalSource === "string") {
    const match = intervalSource.trim().match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
    if (!match) return null;
    return { open: match[1], close: match[2] };
  }
  if (typeof intervalSource !== "object") return null;
  const open = String((intervalSource as any).open || (intervalSource as any).start || (intervalSource as any).from || (intervalSource as any).openingTime || "").trim();
  const close = String((intervalSource as any).close || (intervalSource as any).end || (intervalSource as any).to || (intervalSource as any).closingTime || "").trim();
  if (!open || !close) return null;
  return { open, close };
}

function buildIntervalsForDay(
  daySource: any,
  fallbackOpen: string,
  fallbackClose: string,
  dayKey: SalonDayKey,
  errors: string[],
): SalonInterval[] {
  if (!daySource) return [];
  if (daySource.closed === true || daySource.isClosed === true || daySource.isOpen === false || String(daySource.status || "").trim().toLowerCase() === "closed") {
    return [];
  }

  const rawIntervals = Array.isArray(daySource?.intervals)
    ? daySource.intervals
    : Array.isArray(daySource?.ranges)
      ? daySource.ranges
      : Array.isArray(daySource?.hours)
        ? daySource.hours
        : Array.isArray(daySource?.slots)
          ? daySource.slots
          : Array.isArray(daySource?.windows)
            ? daySource.windows
            : null;

  const intervalSources: unknown[] = rawIntervals?.length
    ? rawIntervals
    : [daySource && typeof daySource === "object" ? daySource : { open: fallbackOpen, close: fallbackClose }];

  return intervalSources
    .map(parseIntervalSource)
    .flatMap((interval) => {
      const open = String(interval?.open || fallbackOpen || "").trim();
      const close = String(interval?.close || fallbackClose || "").trim();
      const startMinutes = parseClockMinutes(open);
      const endMinutes = parseClockMinutes(close);
      if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
        errors.push(`${dayKey}:${open || "?"}-${close || "?"}`);
        return [];
      }
      return [{
        open,
        close,
        startMinutes,
        endMinutes,
        crossesMidnight: endMinutes <= startMinutes,
      }];
    });
}

export function getSalonWeeklySchedule(salon: SalonHoursShape | null | undefined): {
  timeZone: string;
  schedule: SalonWeeklySchedule;
  errors: string[];
  hasConfiguredHours: boolean;
} {
  const schedule = Object.fromEntries(DAY_KEYS.map((dayKey) => [dayKey, [] as SalonInterval[]])) as SalonWeeklySchedule;
  const errors: string[] = [];
  const fallbackOpen = String(salon?.openingTime || salon?.open || "").trim();
  const fallbackClose = String(salon?.closingTime || salon?.close || "").trim();
  const rawWeeklySource = salon?.weeklyOpeningHours || salon?.openingHours || salon?.weeklyHours || salon?.schedule || null;
  const rawWorkingDays = Array.isArray(salon?.workingDays) ? salon.workingDays : [];
  const hasFallbackRange = parseClockMinutes(fallbackOpen) !== null && parseClockMinutes(fallbackClose) !== null && fallbackOpen !== fallbackClose;

  if (rawWeeklySource && typeof rawWeeklySource === "object" && !Array.isArray(rawWeeklySource)) {
    DAY_KEYS.forEach((dayKey) => {
      schedule[dayKey] = buildIntervalsForDay((rawWeeklySource as any)[dayKey], fallbackOpen, fallbackClose, dayKey, errors);
    });
  } else if (Array.isArray(rawWeeklySource) && rawWeeklySource.length) {
    rawWeeklySource.forEach((entry: any) => {
      const dayKey = normalizeDayKey(entry?.day || entry?.key || entry?.name);
      if (!dayKey) return;
      schedule[dayKey] = buildIntervalsForDay(entry, fallbackOpen, fallbackClose, dayKey, errors);
    });
  } else if (rawWorkingDays.length) {
    rawWorkingDays.forEach((entry: any) => {
      if (typeof entry === "string") {
        const dayKey = normalizeDayKey(entry);
        if (!dayKey) return;
        if (!hasFallbackRange) {
          errors.push(`${dayKey}:missing-range`);
          return;
        }
        schedule[dayKey] = buildIntervalsForDay({ open: fallbackOpen, close: fallbackClose }, fallbackOpen, fallbackClose, dayKey, errors);
        return;
      }
      const dayKey = normalizeDayKey(entry?.day || entry?.key || entry?.name);
      if (!dayKey) return;
      schedule[dayKey] = buildIntervalsForDay(entry, fallbackOpen, fallbackClose, dayKey, errors);
    });
  }

  return {
    timeZone: resolveSalonTimeZone(salon),
    schedule,
    errors,
    hasConfiguredHours: Boolean(resolveSalonTimeZone(salon)) && DAY_KEYS.some((dayKey) => schedule[dayKey].length > 0),
  };
}

function isOpenForMinutes(minutes: number, interval: SalonInterval): boolean {
  if (interval.crossesMidnight) {
    return minutes >= interval.startMinutes || minutes < interval.endMinutes;
  }
  return minutes >= interval.startMinutes && minutes < interval.endMinutes;
}

export function getSalonOperatingState(
  salon: SalonHoursShape | null | undefined,
  options: { now?: Date } = {},
): SalonOperatingState {
  const now = options.now || new Date();
  if (!salon || typeof salon !== "object" || salon.isActive === false) {
    return {
      key: "closed",
      isOpen: false,
      timeZone: resolveSalonTimeZone(salon),
      reason: "inactive",
      schedule: Object.fromEntries(DAY_KEYS.map((dayKey) => [dayKey, [] as SalonInterval[]])) as SalonWeeklySchedule,
      errors: [],
    };
  }

  const scheduleInfo = getSalonWeeklySchedule(salon);
  if (!scheduleInfo.hasConfiguredHours) {
    return {
      key: "closed",
      isOpen: false,
      timeZone: scheduleInfo.timeZone,
      reason: "missing-hours",
      schedule: scheduleInfo.schedule,
      errors: scheduleInfo.errors,
    };
  }

  const nowParts = getZonedNowParts(now, scheduleInfo.timeZone);
  const previousDayKey = getAdjacentDayKey(nowParts.dayKey, -1);
  const previousIntervals = scheduleInfo.schedule[previousDayKey].filter((interval) => interval.crossesMidnight && nowParts.minutes < interval.endMinutes);
  const todayIntervals = scheduleInfo.schedule[nowParts.dayKey];
  const activeInterval = previousIntervals.find((interval) => isOpenForMinutes(nowParts.minutes, interval))
    || todayIntervals.find((interval) => isOpenForMinutes(nowParts.minutes, interval))
    || null;

  return {
    key: activeInterval ? "open" : "closed",
    isOpen: Boolean(activeInterval),
    timeZone: scheduleInfo.timeZone,
    reason: activeInterval ? "within-hours" : "outside-hours",
    schedule: scheduleInfo.schedule,
    todayKey: nowParts.dayKey,
    currentMinutes: nowParts.minutes,
    activeInterval,
    errors: scheduleInfo.errors,
  };
}
