/* SUBARU EPC WebUI — vanilla JS app — full 49-endpoint parity */
"use strict";

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
const state = {
  models: [],
  selectedModel: null,
  selectedFig: null,
  zentaizuRegions: [],
  figGroups: [],
  currentFigGroup: null,
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
function ctxParams() {
  const p = new URLSearchParams();
  const area = document.getElementById("area-cd").value;
  const subaru = document.getElementById("subaru-flg").value;
  const lang = document.getElementById("language").value;
  if (area) p.set("area_cd", area);
  if (subaru) p.set("subaru_flg", subaru);
  if (lang) p.set("language", lang);
  return p;
}

async function api(path, extraParams) {
  // Static-only distribution: every lookup resolves from pre-built chunks.
  // No /api fallback — errors surface to the caller's error rendering.
  // Tailed paths (parts/exchange/<num> etc) split: tail → _pathTail param
  const m = path.match(/^(parts\/(?:exchange|price|name)\/)(.+)$/);
  if (m) {
    return staticApi(m[1].replace(/\/$/, ""),
      { ...(extraParams || {}), _pathTail: m[2] });
  }
  return staticFirstApi(path, extraParams);
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tableHTML(headers, rows, cellFn) {
  if (!rows || !rows.length) return '<p style="color:var(--outline)">該当なし</p>';
  const thead = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const tbody = rows.map((r, i) => {
    const cells = headers.map((_, ci) => `<td>${cellFn(r, ci, i)}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

// SFAST0090D 車両検索結果テーブル (基本カラム + 型式/モデル列)
function vinTableHTML(rows, srcCols) {
  const src = (r) => (srcCols || []).map((c) => esc(r[c === "型式" ? "KATASHIKI" : "MODEL"] || "")).join("");
  return `<table>
    <thead><tr><th>No</th><th>カタログ車種</th><th>車台番号 (前)</th><th>車台番号 (後)</th><th>TRIM_CD</th><th>仕向地</th>${(srcCols || []).map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.map((r, i) => `<tr>
        <td class="num-cell">${i + 1}</td>
        <td>${esc(r.SHASHUCTLG || r.SYASYU_CD || "")}</td>
        <td>${esc(r.VIN_BEFORE)}</td>
        <td>${esc(r.VIN_AFTER)}</td>
        <td>${esc(r.TRIM_CD)}</td>
        <td>${esc(r.DESTINATION)}</td>
        ${src(r)}
      </tr>`).join("")}
    </tbody>
  </table>`;
}

// ---------------------------------------------------------------------------
// "Tabs" = accordion sections. activateTab(name) opens & scrolls to it.
// ---------------------------------------------------------------------------
function activateTab(name) {
  const sec = document.getElementById("sec-" + name);
  if (!sec) return;
  const acc = sec.querySelector("details.acc");
  if (acc) acc.open = true;
  sec.scrollIntoView({ behavior: "smooth", block: "start" });
  if (name === "diagram") loadDiagModels && loadDiagModels();
}
