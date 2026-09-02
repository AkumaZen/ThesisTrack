import { escapeHtml } from "./format.js";

function sourceBadge(source) {
  const styles = {
    rule_engine: "bg-slate-100 text-slate-700",
    ai_proposed: "bg-violet-50 text-violet-700",
    manual: "bg-blue-50 text-blue-700",
  };
  return `<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${styles[source] || "bg-slate-100"}">${source.replace("_", " ")}</span>`;
}

export function renderReviewQueue(proposals) {
  if (!proposals.length) {
    return `<div class="text-center text-slate-400 py-16">Nothing pending — review queue is empty.</div>`;
  }
  return `<div class="space-y-3">
    ${proposals
      .map(
        (p) => `
      <div class="rounded-lg border border-slate-200 bg-white p-4" data-proposal-id="${p.id}">
        <div class="flex items-center justify-between">
          <div class="font-medium">${escapeHtml(p.company_id)} <span class="text-slate-400 font-normal">· ${escapeHtml(p.period || "")}</span></div>
          <div class="flex items-center gap-2">
            ${sourceBadge(p.source)}
            <span class="text-xs font-medium px-2 py-0.5 rounded-full ${p.proposed_status === "broken" ? "bg-rose-50 text-rose-700" : p.proposed_status === "watch_closely" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}">
              &rarr; ${p.proposed_status}
            </span>
          </div>
        </div>
        <p class="text-sm text-slate-600 mt-1">${escapeHtml(p.rationale)}</p>
        ${
          p.evidence?.reasoning_chain
            ? `<ol class="list-decimal list-inside text-xs text-slate-500 mt-1 space-y-0.5">
                ${p.evidence.reasoning_chain.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
              </ol>`
            : ""
        }
        <div class="mt-3 flex items-center gap-2">
          <input type="text" placeholder="Resolution note (required to override a fired kill trigger)"
            class="resolve-note flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs" />
          <button data-resolve="accept" class="text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700">Accept</button>
          <button data-resolve="reject" class="text-xs px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700">Reject</button>
        </div>
      </div>`
      )
      .join("")}
  </div>`;
}
