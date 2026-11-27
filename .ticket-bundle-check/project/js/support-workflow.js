const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EAT = 3 * HOUR;

export const FIRST_RESPONSE_HOURS = 2;
export const RESOLUTION_HOURS = 16;

function date(value) {
  if (!value) return null;
  const result = value.toDate?.() ?? (typeof value.seconds === "number" ? new Date(value.seconds * 1000) : new Date(value));
  return Number.isFinite(result.getTime()) ? result : null;
}

// EAT has a fixed UTC offset. Work hours are Monday–Friday, 08:00–17:00 EAT.
export function businessDeadline(start, hours) {
  const beginning = date(start);
  if (!beginning) return null;
  let cursor = beginning.getTime() + EAT;
  let remaining = hours * HOUR;
  while (remaining > 0) {
    const midnight = Math.floor(cursor / DAY) * DAY;
    const weekday = new Date(midnight).getUTCDay();
    const end = midnight + 17 * HOUR;
    if (weekday === 0 || weekday === 6 || cursor >= end) {
      cursor = midnight + DAY + 8 * HOUR;
      continue;
    }
    cursor = Math.max(cursor, midnight + 8 * HOUR);
    const worked = Math.min(remaining, end - cursor);
    cursor += worked;
    remaining -= worked;
  }
  return new Date(cursor - EAT);
}

export function getTicketTiming(ticket, now = new Date()) {
  const start = ticket.cycleStartedAt || ticket.raisedAt;
  const firstResponseDue = businessDeadline(start, FIRST_RESPONSE_HOURS);
  const resolutionDue = businessDeadline(start, RESOLUTION_HOURS);
  const open = ticket.status === "open";
  const firstResponseOverdue = !!(open && !ticket.firstResponseAt && firstResponseDue && now >= firstResponseDue);
  const resolutionOverdue = !!(open && resolutionDue && now >= resolutionDue);
  return { firstResponseDue, resolutionDue, firstResponseOverdue, resolutionOverdue };
}
