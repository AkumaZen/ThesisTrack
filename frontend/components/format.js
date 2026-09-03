export const STATUS_STYLES = {
  on_track: { label: "On Track", dot: "bg-good", pill: "bg-good/10 text-good ring-good/20" },
  watch_closely: { label: "Watch Closely", dot: "bg-warn", pill: "bg-warn/10 text-warn ring-warn/20" },
  broken: { label: "Broken", dot: "bg-danger", pill: "bg-danger/10 text-danger ring-danger/20" },
};

export function formatMetricValue(value, unit, decimals = 1) {
  if (value === null || value === undefined) return "-";
  const n = Number(value);
  switch (unit) {
    case "pct":
      return `${n.toFixed(decimals)}%`;
    case "days":
      return `${n.toFixed(0)}d`;
    case "ratio":
      return n.toFixed(2);
    case "count":
      return n.toFixed(0);
    case "currency":
      return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    case "currency_per_unit":
      return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    default:
      return String(n);
  }
}

export function daysSince(dateStr) {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
