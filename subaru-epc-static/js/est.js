// ---------------------------------------------------------------------------
// 選択部品バスケット — 部品番号特定作業用 (見積書・印刷・値引はスコープ外)
// ---------------------------------------------------------------------------
const EST_KEY = "subaru-epc-estimate";
// 消費税は算しない (価格が2019-05参考値のため税別表示のみ — ユーザー指定 2026-10-13)

const EST = {
  items: [],   // {parts_number, parts_name, quantity, unit_price, syasyu, fig}
};

function estLoad() {
  try {
    const raw = localStorage.getItem(EST_KEY);
    if (raw) EST.items = JSON.parse(raw) || [];
  } catch (e) { EST.items = []; }
  estRender();
}

function estSaveAll() {
  localStorage.setItem(EST_KEY, JSON.stringify(EST.items));
}

function yen(n) {
  const v = Math.round(Number(n) || 0);
  return "¥" + v.toLocaleString("ja-JP");
}

// --- Add part to the basket (from any parts list) ---
window.addEstimate = function (partsNumber, partsName, quantity, unitPrice, syasyu, fig) {
  if (!partsNumber) { toast("部品番号が不明です"); return; }
  const qty = Math.max(1, parseInt(quantity) || 1);
  // 静的モード時: 直近の parts/catalog 応答 (state.diagramParts) から単価を補完
  if (!unitPrice && staticUIAvailable && Array.isArray(state.diagramParts)) {
    const hit = state.diagramParts.find((p) => p.PARTS_NUMBER === partsNumber);
    if (hit && hit.price > 0) unitPrice = hit.price;
  }
  const existing = EST.items.find((it) => it.parts_number === partsNumber);
  if (existing) {
    existing.quantity += qty;
    toast(`${partsNumber} の数量を ${existing.quantity} にしました`);
  } else {
    EST.items.push({
      parts_number: partsNumber,
      parts_name: partsName || "",
      quantity: qty,
      unit_price: unitPrice ? Number(unitPrice) : 0,
      syasyu: syasyu || "",
      fig: fig || "",
    });
    toast(`${partsNumber} を見積に追加しました`);
  }
  estSaveAll();
  estRender();
  renderDiagBasket();
};

// --- 展開図右ペインのバスケットリスト (常時可視 / 見積と同一データ) ---
function renderDiagBasket() {
  const el = document.getElementById("diag-basket-list");
  if (!el) return;
  if (!EST.items.length) {
    el.innerHTML = '<div class="small-text" style="opacity:0.6;padding:4px;">明細なし — 図面の部品「追加」でここに積まれます</div>';
    return;
  }
  el.innerHTML = EST.items.map((it, i) => `
    <div class="bitem">
      <span class="code">${esc(it.parts_number)}</span>
      <span class="name">${esc(it.parts_name || "")}</span>
      <span class="qty-box"><input type="text" inputmode="numeric" class="bitem-qty" data-idx="${i}" value="${esc(it.quantity)}" title="数量"></span>
      <button class="small round transparent" onclick="removeEstimate(${i})" title="削除"><i>close</i></button>
    </div>`).join("");
  el.querySelectorAll(".bitem-qty").forEach((inp) => {
    inp.addEventListener("change", () => {
      const it = EST.items[parseInt(inp.dataset.idx)];
      if (it) { it.quantity = Math.max(1, parseInt(inp.value) || 1); estSaveAll(); estRender(); }
    });
  });
}

window.removeEstimate = function (idx) {
  if (EST.items[idx]) {
    toast(`${EST.items[idx].parts_number} を削除しました`);
    EST.items.splice(idx, 1);
  }
  estSaveAll();
  estRender();
  renderDiagBasket();
};

// --- Basket table + totals (SEPCW0000 / SEPCW0120 見積総合計) ---
function lineNet(it) {
  return Math.max(0, (Number(it.quantity) || 0) * (Number(it.unit_price) || 0));
}

// 品番引くの候補リスト / 要確認表示 (count 0 / count > 1) — SEPCW0300 相当ダイアログを開くボタン付き
function candidatesHTML(it) {
  if (!it.candidates || !it.candidates.length) {
    return it.resolve_miss
      ? ' <span class="small-text" style="color:#f9b234;">⚠ 該当なし — この車両に適合する番号がありません (他車種部品の可能性。互換タブで確認)</span>'
      : "";
  }
  const idx = EST.items.indexOf(it);
  // 候補品番の展開リストは廃止 — ボタン → SEPCW0300 相当ダイアログで選ぶ
  return ` <button class="border small" onclick="openCandidateDialog(${idx});return false;">候補${it.candidates.length}件 選択</button>`;
}

// ---------------------------------------------------------------------------
// SEPCW0300 部品番号選択ダイアログ (要確認時: 候補一覧から本文を選択)
// 原版列: 選択 / 部品番号+互換 / 年改 / 採用-廃止 / 固有諸元・固有色 / 適用車種 / FIG / 個数
// ---------------------------------------------------------------------------
window.openCandidateDialog = function (itemIdx) {
  const it = EST.items[itemIdx];
  if (!it || !it.candidates || !it.candidates.length) return;
  const d = document.getElementById("candidate-dialog");
  document.getElementById("cd-title").textContent =
    `候補の確認・選択 — ${it.parts_number || it.parts_code || ""} (${it.candidates.length}候補)`;
  const rows = it.candidates.map((c, i) => {
    if (typeof c === "string") {
      return `<tr><td>${i + 1}</td><td colspan="7">${esc(c)}</td></tr>`;
    }
    const saihai = `${esc(c.SAIYOU_YMD || "")}${c.HAISHI_YMD ? " - " + esc(c.HAISHI_YMD) : ""}`;
    // 固有諸元・固有色: KOYU_SHOGEN + KOSHOKU_SHOGEN + INT_COLOR + HYOUGEN(適用オプション)
    const shogen = [c.KOYU_SHOGEN, c.KOSHOKU_SHOGEN, c.INT_COLOR]
      .filter(Boolean).map(esc).join(" / ");
    const hyougen = [c.HYOUGEN1, c.HYOUGEN2, c.HYOUGEN3, c.HYOUGEN4, c.HYOUGEN5]
      .filter(Boolean).map(esc).join(", ");
    const tekiyou = [shogen, hyougen, esc(c.TEKIYOU || "")].filter(Boolean).join("<br>");
    const selIdx = it.candidates.findIndex((c) => esc(c.PARTS_NUMBER) === esc(it.parts_number));
    return `<tr class="${selIdx === i ? "selected" : ""}">
      <td class="num-cell">${selIdx === i ? "✔" : i + 1}</td>
      <td class="clickable cd-pick" data-idx="${i}"><b>${esc(c.PARTS_NUMBER || "")}</b>${c.EXCHANGE_PARTS_NUMBER ? `<br><span class="small-text">[${esc(c.JOKEN || "")}] ${esc(c.EXCHANGE_PARTS_NUMBER)}</span>` : ""}</td>
      <td>${esc(c.NENKAI || "")}</td>
      <td class="small-text">${saihai}</td>
      <td class="small-text">${tekiyou || "—"}</td>
      <td class="small-text">${esc(c.KATASHIKI || "")}${c.DESTINATION ? `<br>仕向 ${esc(c.DESTINATION)}` : ""}</td>
      <td>${esc(c.FIG_NO || "")}</td>
      <td>${esc(c.QUANTITY || "")}</td>
      <td class="num-cell">${c.BUHIN_TANKA ? "¥" + Number(c.BUHIN_TANKA).toLocaleString("ja-JP") : "—"}</td>
    </tr>`;
  }).join("");
  document.getElementById("cd-candidates-body").innerHTML = rows;
  document.getElementById("cd-pick-btn").onclick = () => {
    const sel = document.querySelector("#cd-candidates-body tr.selected");
    if (!sel) { toast("候補をクリックして選択してください"); return; }
    const i = Number(sel.querySelector(".cd-pick").dataset.idx);
    const c = it.candidates[i];
    if (c && c.PARTS_NUMBER) {
      it.parts_number = c.PARTS_NUMBER;
      // 単価: 候補の BUHIN_TANKA を反映 (手入力が無い場合)
      const t = parseInt(c.BUHIN_TANKA, 10);
      if (!it.unit_price && t > 0) it.unit_price = t;
      it.resolve_miss = false;
      estSaveAll(); estRender(); renderDiagBasket();
    }
    d.close();
  };
  // 行クリックで選択状態 (✔印と同時に「選択中: xxx」ステータスも出す)
  const statusEl = document.getElementById("cd-sel-status");
  const showSel = () => {
    const sel = document.querySelector("#cd-candidates-body tr.selected .cd-pick");
    if (statusEl) statusEl.textContent = sel ? `選択中: ${sel.textContent.trim().split("\n")[0]}` : "未選択";
  };
  showSel();
  document.querySelectorAll("#cd-candidates-body tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      document.querySelectorAll("#cd-candidates-body tr.selected").forEach((x) => {
        x.classList.remove("selected");
        x.querySelector(".num-cell").textContent = x.querySelector(".num-cell").dataset.idx;
      });
      tr.classList.add("selected");
      const nc = tr.querySelector(".num-cell");
      nc.dataset.idx = nc.textContent;
      nc.textContent = "✔";
      showSel();
    });
  });
  d.showModal();
};
document.getElementById("cd-cancel-btn").addEventListener("click", () => {
  document.getElementById("candidate-dialog").close();
});

function estRender() {
  const el = document.getElementById("estimate-table");
  const totalsEl = document.getElementById("estimate-totals");
  if (!el) return;

  if (!EST.items.length) {
    el.innerHTML = '<p class="dim">選択部品はありません。展開図のホットスポットや各検索の「追加」で部品を積んでください。</p>';
    totalsEl.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="table-scroll"><table>
      <thead><tr>
        <th>No</th><th>部品番号</th><th>部品名</th><th>車種</th><th>FIG</th>
        <th>数量</th><th>単価</th><th>金額</th><th>互換</th><th></th>
      </tr></thead>
      <tbody>
        ${EST.items.map((it, i) => `
          <tr class="${it.resolve_miss ? "resolve-miss" : ""}">
            <td>${i + 1}</td>
            <td>${esc(it.parts_number)}</td>
            <td>${esc(it.parts_name || "—")}${candidatesHTML(it)}</td>
            <td>${esc(it.syasyu || "")}</td>
            <td>${esc(it.fig || "")}</td>
            <td><input type="number" class="est-input est-qty" data-idx="${i}" min="1" value="${esc(it.quantity)}"></td>
            <td><input type="number" class="est-input est-price" data-idx="${i}" min="0" value="${esc(it.unit_price)}"></td>
            <td style="text-align:right;">${yen(lineNet(it))}</td>
            <td><button class="border small" onclick="goExchange('${esc(it.parts_number)}','${esc(it.syasyu || "")}')">互換</button></td>
            <td><button class="border small est-remove" data-idx="${i}">削除</button></td>
          </tr>`).join("")}
      </tbody>
    </table></div>`;

  const subtotal = EST.items.reduce((s, it) => s + lineNet(it), 0);
  // 消費税は表示しない (価格は2019-05参考値のため税別のみ)
  totalsEl.innerHTML = `
    <table>
      <tr><th>小計 (税抜)</th><td style="text-align:right;">${yen(subtotal)}</td></tr>
      <tr><th>合計</th><td style="text-align:right;font-size:18px;color:var(--error,var(--primary));">${yen(subtotal)}</td></tr>
    </table>`;

  el.querySelectorAll(".est-qty").forEach((inp) => inp.addEventListener("change", estLineChange));
  el.querySelectorAll(".est-price").forEach((inp) => inp.addEventListener("change", estLineChange));
  el.querySelectorAll(".est-remove").forEach((btn) => btn.addEventListener("click", estRemove));
}

function estLineChange(e) {
  const idx = parseInt(e.target.dataset.idx);
  const it = EST.items[idx];
  if (!it) return;
  const v = (key, fallback) => {
    const el = document.querySelector(`.${key}[data-idx="${idx}"]`);
    return el ? Number(el.value) || fallback : fallback;
  };
  it.quantity = Math.max(1, v("est-qty", 1));
  it.unit_price = Math.max(0, v("est-price", 0));
  estSaveAll();
  estRender();
  renderDiagBasket();
}

function estRemove(e) {
  const idx = parseInt(e.target.dataset.idx);
  if (EST.items[idx]) {
    toast(`${EST.items[idx].parts_number} を削除しました`);
    EST.items.splice(idx, 1);
  }
  estSaveAll();
  estRender();
  renderDiagBasket();
}

// --- 数量一括設定 (SEPCW0010) ---
document.getElementById("est-bulk-apply").addEventListener("click", () => {
  const qty = parseInt(document.getElementById("est-bulk-qty").value);
  if (!qty || qty < 1) { toast("数量を入力してください"); return; }
  EST.items.forEach((it) => { it.quantity = qty; });
  toast(`全 ${EST.items.length} 件の数量を ${qty} に設定しました`);
  estSaveAll();
  estRender();
  renderDiagBasket();
});


document.getElementById("diag-basket-resolve").addEventListener("click", resolveEstimate);
document.getElementById("diag-basket-clear").addEventListener("click", () => {
  if (!EST.items.length) return;
  if (!confirm("選択部品を全て消去しますか？")) return;
  EST.items = [];
  estSaveAll();
  estRender();
  renderDiagBasket();
});
document.getElementById("est-clear-btn").addEventListener("click", () => {
  if (!EST.items.length) return;
  if (!confirm("見積明細を全て消去しますか？")) return;
  EST.items = [];
  estSaveAll();
  estRender();
  renderDiagBasket();
});

// --- 品番引く — manifest.figsByCode → fig チャンク → staticNarrowRows で
// VIN適合の純正部品番号を一括取得 (静的配布: API フォールバックなし)。
// 展開図右ペインの「部品番号検索」ボタンからも呼ばれる (原版 SEPCW0390→SEPCW0300 相当)
async function resolveEstimate() {
  if (!EST.items.length) { toast("見積明細がありません"); return; }
  const btn = document.getElementById("est-resolve-btn");
  const status = document.getElementById("est-resolve-status");
  const ctx = getVinContext();
  const vb = (ctx && ctx.vinBefore) || (document.getElementById("vin-before") || {}).value || "";
  const va = (ctx && ctx.vinAfter) || (document.getElementById("vin-after") || {}).value || "";
  // 原版準拠 (MitsumoriViewModel.searchPartsNumber): 部品番号"未確定"の行だけが対象。
  // 部品コード(5桁)のみを送る。parts_code に部品番号(12桁)が入っている行は未引とみなして
  // 頭7桁相当を復元する (e.g. 11010AA000 → 11010) 。
  const isCode = (v) => v && v.length <= 7 && !/AA|KA|GA|AG/.test(v);
  const targets = EST.items.map((it) => {
    if (isCode(it.parts_number)) return it.parts_number;
    // 部品番号から部品コードを復元 (最初の数字5桁)
    const m = String(it.parts_number).match(/^(\d{4,6})/);
    return m ? m[1] : it.parts_number;
  });
  const body = {
    syasyu: (ctx && ctx.syasyu) || (EST.items.find((it) => it.syasyu) || {}).syasyu || "",
    vin_before: vb,
    vin_after: va,
    trim_cd: (ctx && (ctx.trimCd || ctx.trim)) || undefined,
    destination: (ctx && ctx.destination) || undefined,
    option_code: (ctx && ctx.optionCode) || undefined,
    model_positions: (ctx && ctx.modelPosition) ? [parseInt(ctx.modelPosition)] : undefined,
    bd_seisan_ymd: (ctx && ctx.bd) || undefined,
    eg_seisan_ymd: (ctx && ctx.eg) || undefined,
    tm_seisan_ymd: (ctx && ctx.tm) || undefined,
    model: (ctx && ctx.model) || undefined,
    color_cd: (ctx && ctx.colorCode) || undefined,
    items: targets.map((code) => ({ parts_code: code })),
  };
  btn.disabled = true;
  if (status) status.innerHTML = '<span class="loading"></span> 品番を引いています…';
  try {
    // 静的配布は API フォールバックなし: figsByCode → figチャンク → staticNarrowRows
    const m = await getCatalogManifest(body.syasyu);
    const seen = new Set();
    const results = [];
    const uniqueTargets = [...new Set(targets)];
    for (const code of uniqueTargets) {
      const figs = m.figsByCode[code] || [];
      let candidates = [];
      for (const fn of figs) {
        if (!seen.has(fn)) {
          seen.add(fn);
          const chunk = await fetchStatic(`catalog/${body.syasyu}/fig-${fn}.json`);
          window._staticChunkCache = window._staticChunkCache || {};
          window._staticChunkCache[fn] = chunk;
        }
        const c = window._staticChunkCache[fn];
        const rows = (c.parts[code] || []).map((r) => ({ ...r, FIG_NO: fn }));
        candidates = candidates.concat(rows);
      }
      const sch = { ...(ctx || {}) };
      sch._figNo = figs[0] || "";
      const narrowed = staticNarrowRows(candidates, sch).map(staticFormatRow);
      const first = narrowed[0] || null;
      results.push({
        parts_code: code,
        fig_no: figs[0] || "",
        parts_number: first ? String(first.PARTS_NUMBER) : null,
        parts_name: first ? String(first.PARTS_NAME || "") : null,
        price: first ? (first.price || null) : null,
        candidates: narrowed,
        count: narrowed.length,
      });
    }
    const byCode = {};
    results.forEach((r) => { byCode[r.parts_code] = r; });
    let ok = 0, miss = 0;
    EST.items.forEach((it, i) => {
      const r = byCode[targets[i]];
      if (!r) { it.resolve_count = 0; it.resolve_miss = true; it.candidates = []; miss++; return; }
      const name = r.parts_name || it.parts_name || "";
      if (r.parts_number) it.parts_number = r.parts_number;
      it.parts_name = name;
      const price = parseInt(r.price, 10);
      if (!it.unit_price && price > 0) it.unit_price = price;
      it.resolve_count = r.count || 0;
      it.resolve_miss = (r.count || 0) === 0;
      it.candidates = r.candidates || [];
      if (it.resolve_miss) miss++; else ok++;
    });
    estSaveAll();
    estRender();
    renderDiagBasket();
    if (status) status.innerHTML = miss
      ? `品番引く完了: <strong>${ok}件確定</strong> / <strong style="color:#f9b234">${miss}件要確認</strong> — 一覧の行にある「⚠ 候補がN件あります」を展開し、正しい部品番号 (生産年月日・エンジン・仕向け違い) を選んでください`
      : `品番引く完了: ${ok}件確定`;
    toast(miss
      ? `品番引く完了 — ${ok}件確定, ${miss}件は「候補」から選択してください`
      : `品番引く完了 — ${ok}件確定`);
    // 展開図から呼ばれた場合は見積タブへ誘導して結果を可視化
    if (!status || !status.offsetParent) {
      activateTab("basket");
    }
  } catch (e) {
    if (status) status.textContent = "品番引きに失敗: " + e.message;
    toast("品番引きに失敗: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("est-resolve-btn").addEventListener("click", resolveEstimate);

// --- (印刷/保存/顧客フォームはスコープ外 — 削除) ---

// ---------------------------------------------------------------------------
// Estimate init
// ---------------------------------------------------------------------------
estLoad();
