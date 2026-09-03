import { escapeHtml } from "./format.js";

function sourceBadge(source) {
  const styles = {
    rule_engine: "bg-surface-3 text-fg",
    ai_proposed: "bg-accent/10 text-accent",
    manual: "bg-ok/10 text-ok",
  };
  return `<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${styles[source] || "bg-surface-3"}">${source.replace("_", " ")}</span>`;
}

export function renderReviewQueue(proposals) {
  if (!proposals.length) {
    return `<div class="text-center text-muted-fg py-16">Nothing pending - review queue is empty.</div>`;
  }
  return `<div class="space-y-3">
    ${proposals
      .map(
        (p) => `
      <div class="rounded-lg border border-border bg-surface p-4" data-proposal-id="${p.id}">
        <div class="flex items-center justify-between">
          <div class="font-medium">${escapeHtml(p.company_id)} <span class="text-muted-fg font-normal">· ${escapeHtml(p.period || "")}</span></div>
          <div class="flex items-center gap-2">
            ${sourceBadge(p.source)}
            <span class="text-xs font-medium px-2 py-0.5 rounded-full ${p.proposed_status === "broken" ? "bg-danger/10 text-danger" : p.proposed_status === "watch_closely" ? "bg-warn/10 text-warn" : "bg-good/10 text-good"}">
              &rarr; ${p.proposed_status}
            </span>
          </div>
        </div>
        <p class="text-sm text-muted-fg mt-1">${escapeHtml(p.rationale)}</p>
        ${
          p.evidence?.reasoning_chain
            ? `<ol class="list-decimal list-inside text-xs text-muted-fg mt-1 space-y-0.5">
                ${p.evidence.reasoning_chain.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
              </ol>`
            : ""
        }
        <div class="mt-3 flex items-center gap-2">
          <input type="text" placeholder="Resolution note (required to override a fired kill trigger)"
            class="resolve-note flex-1 rounded-md border border-border px-2 py-1 text-xs" />
          <button data-resolve="accept" class="text-xs px-3 py-1.5 rounded-md bg-good text-accent-ink hover:brightness-90">Accept</button>
          <button data-resolve="reject" class="text-xs px-3 py-1.5 rounded-md bg-danger text-white hover:brightness-90">Reject</button>
        </div>
      </div>`
      )
      .join("")}
  </div>`;
}
