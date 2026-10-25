export type ServerTime = {
  iso: string;
  unixMs: number;
  timeZone: string;
  utcOffset: string;
};

export function getServerTime(now: Date = new Date()): ServerTime {
  const timeZone =
    process.env.TZ?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");

  return {
    iso: now.toISOString(),
    unixMs: now.getTime(),
    timeZone,
    utcOffset: `${sign}${hours}:${minutes}`,
  };
}
