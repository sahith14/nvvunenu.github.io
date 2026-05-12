// Time formatting + WhatsApp-style message grouping.
const DAY = 86_400_000;

export function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();        // Firestore Timestamp
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  return new Date(ts);
}

export function formatTimeAgo(input) {
  const d = toDate(input); if (!d) return "";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800)return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString();
}

export function formatClock(input) {
  const d = toDate(input); if (!d) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// "Today" / "Yesterday" / "Mon 12 May 2025"
export function formatDayHeader(input) {
  const d = toDate(input); if (!d) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday)          return "Today";
  if (t >= startToday - DAY)    return "Yesterday";
  if (t >= startToday - 7*DAY)  return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// Inject a day-separator whenever the day changes between consecutive messages.
// Returns an array of { kind:"sep", label } | { kind:"msg", msg }.
export function groupByDay(messages) {
  const out = [];
  let lastLabel = null;
  for (const m of messages) {
    const label = formatDayHeader(m.time || m.createdAt);
    if (label !== lastLabel) { out.push({ kind: "sep", label }); lastLabel = label; }
    out.push({ kind: "msg", msg: m });
  }
  return out;
}
