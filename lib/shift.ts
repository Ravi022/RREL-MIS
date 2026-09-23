import { MIS_TIMEZONE } from "./config";

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "0";
  const offset = (get("timeZoneName") || "GMT+00:00").replace("GMT", "") || "+00:00";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    offset: offset === "Z" ? "+00:00" : offset,
  };
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDateBack(year: number, month: number, day: number) {
  const utc = Date.UTC(year, month - 1, day - 1);
  const shifted = new Date(utc);
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function activeShiftContext(now = new Date()) {
  const local = zonedParts(now, MIS_TIMEZONE);
  const hour = local.hour;
  let shift: "A" | "B" | "C";
  let start: string;
  let end: string;
  let operationalDate: string;
  if (hour >= 6 && hour < 14) {
    shift = "A";
    start = "06:00";
    end = "14:00";
    operationalDate = isoDate(local.year, local.month, local.day);
  } else if (hour >= 14 && hour < 22) {
    shift = "B";
    start = "14:00";
    end = "22:00";
    operationalDate = isoDate(local.year, local.month, local.day);
  } else {
    shift = "C";
    start = "22:00";
    end = "06:00";
    operationalDate =
      hour < 6
        ? shiftDateBack(local.year, local.month, local.day)
        : isoDate(local.year, local.month, local.day);
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: operationalDate,
    shift,
    hours: `${start} – ${end}`,
    timezone: MIS_TIMEZONE,
    serverTime: `${isoDate(local.year, local.month, local.day)}T${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}${local.offset}`,
  };
}

export function utcIso() {
  return new Date().toISOString().replace("Z", "+00:00");
}
