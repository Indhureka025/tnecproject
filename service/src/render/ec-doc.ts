import type { EcResult } from "../canonical.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Render the canonical EC result as a self-contained HTML document. This is the
 * artifact stored in the object store and handed to the ERP as `ec_summary`.
 * It is a *summary of retrieved data*, not the government-issued certificate —
 * the disclaimer says so.
 */
export function renderEcHtml(result: EcResult): string {
  const p = result.search.property;
  const rows = result.entries
    .map(
      (e) => `<tr>
      <td>${e.seq}</td>
      <td>${esc(e.instrumentType)}<br><small>${esc(e.rawInstrumentType)}</small></td>
      <td>${esc(e.documentNumber)}</td>
      <td>${esc(e.registrationDate)}</td>
      <td>${e.considerationAmount ? "₹" + e.considerationAmount.value.toLocaleString("en-IN") : "—"}</td>
      <td>${e.parties.map((pt) => `${esc(pt.name)} <small>(${esc(pt.role)})</small>`).join("<br>")}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>EC summary — ${esc(p.village)} ${esc(p.surveyNumber)}</title>
<style>
 body{font:13px/1.5 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#1a1a1a}
 h1{font-size:17px;margin:0 0 2px} .sub{color:#666;margin:0 0 16px}
 table{border-collapse:collapse;width:100%;margin:12px 0} th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
 th{background:#f4f4f6} .badge{display:inline-block;padding:2px 8px;border-radius:10px;background:#eee;font-weight:600}
 .disc{border-left:3px solid #b7791f;padding:8px 12px;background:#fdf6e8;color:#663;margin-top:16px;font-size:12px}
 dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0}
</style></head><body>
<h1>Encumbrance Certificate — retrieved summary</h1>
<p class="sub">Generated ${esc(result.provenance.retrievedAt)} · source: ${esc(result.provenance.source)}${result.provenance.certified ? " · certified/signed" : ""}</p>
<dl>
 <dt>Zone / District</dt><dd>${esc(p.zone)} / ${esc(p.district)}</dd>
 <dt>SRO</dt><dd>${esc(p.sroCode)}</dd>
 <dt>Village</dt><dd>${esc(p.village)}</dd>
 <dt>Survey / Subdivision</dt><dd>${esc(p.surveyNumber)} / ${esc(p.subdivisionNumber)}</dd>
 <dt>Period searched</dt><dd>${esc(result.search.period.from)} to ${esc(result.search.period.to)}</dd>
 <dt>Outcome</dt><dd><span class="badge">${esc(result.outcome)}</span> — encumbrance present: <b>${result.encumbrancePresent === null ? "unknown (needs review)" : result.encumbrancePresent ? "yes" : "no"}</b></dd>
</dl>
${
  result.entries.length
    ? `<table><thead><tr><th>#</th><th>Nature</th><th>Doc no.</th><th>Registered</th><th>Consideration</th><th>Parties</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p><i>No registered instruments returned for this property and period.</i></p>`
}
${result.caveats.length ? `<p><b>Caveats:</b></p><ul>${result.caveats.map((c) => `<li>${esc(c.code)} — ${esc(c.message)}</li>`).join("")}</ul>` : ""}
<p class="disc">${esc(result.disclaimer)}</p>
</body></html>`;
}
