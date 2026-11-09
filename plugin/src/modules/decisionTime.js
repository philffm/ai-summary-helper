// modules/decisionTime.js — when a "read later" reminder is due (Später lesen). Pure; used by the background worker
// (alarms), the MCP tool list_due and the tests, so all agree on the same time.
//   tomorrow → tomorrow at the reminder time · weekend → the next Saturday (on a Saturday: Sunday) at the reminder time
//   week     → next Monday at the reminder time · none (and the old 'research') → no reminder
// The reminder time is a local "HH:MM" (Settings › Reading › Später lesen), default 08:00.

export const DECISION_TIMEFRAMES = ['tomorrow', 'weekend', 'week', 'none'];
export const DEFAULT_REMINDER_TIME = '08:00';

function decisionAt(base, days, hhmm) {
  const [h, m] = (/^\d{1,2}:\d{2}$/.test(hhmm || '') ? hhmm : DEFAULT_REMINDER_TIME).split(':').map(Number);
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(Math.min(23, h), Math.min(59, m), 0, 0);
  return d;
}

/** Epoch ms when the reminder for `timeframe` saved at `savedAt` is due, or null for no reminder. */
export function decisionDueAt(timeframe, savedAt = Date.now(), reminderTime = DEFAULT_REMINDER_TIME) {
  const base = new Date(typeof savedAt === 'number' ? savedAt : Date.parse(savedAt) || Date.now());
  const day = base.getDay();   // 0 = Sunday … 6 = Saturday
  switch (timeframe) {
    case 'tomorrow': return decisionAt(base, 1, reminderTime).getTime();
    case 'weekend': return decisionAt(base, day === 6 ? 1 : (6 - day + 7) % 7 || 7, reminderTime).getTime();
    case 'week': return decisionAt(base, ((1 - day + 7) % 7) || 7, reminderTime).getTime();
    default: return null;
  }
}
