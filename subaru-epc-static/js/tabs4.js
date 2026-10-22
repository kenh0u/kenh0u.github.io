// ---------------------------------------------------------------------------
// Tab 4: Exchange Parts
// ---------------------------------------------------------------------------
document.getElementById("exchange-search-btn").addEventListener("click", async () => {
  const partsNum = document.getElementById("exchange-parts-num").value.trim();
  const syasyu = document.getElementById("exchange-syasyu").value.trim();
  if (!partsNum) { toast("部品番号を入力してください"); return; }
  const el = document.getElementById("exchange-results");
  el.innerHTML = '<div class="card"><div class="loading"></div> 検索中…</div>';
  try {
    const rows = await api(`parts/exchange/${partsNum}`, { syasyu_code: syasyu });
    if (!rows.length) {
      el.innerHTML = '<div class="card"><p>交換部品なし</p></div>';
      return;
    }
    // SEPCW0350 互換部品番号選択 — columns:
    // No / 選択 / 部品番号 / 条件 / 条件の意味 / 互換情報 / 互換部品番号 / 個数 / 数量 / 部品コード名称 / 部品コード / 摘要
    let html = `<div class="card"><h6 class="large-text">互換部品一覧 (${rows.length}件)</h6><div id="exchange-tree">`;
    html += `
      <table>
        <thead><tr>
          <th>No</th><th>選択</th><th>部品番号</th><th>条件</th><th>条件の意味</th>
          <th>互換情報</th><th>互換部品番号</th><th>個数</th><th>数量</th><th>部品コード名称</th><th>部品コード</th><th>摘要</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => {
            const pn = r.EXCHANGE_PARTS_NUMBER || r.VIEW_PARTS_NUMBER || "";
            return `
            <tr>
              <td class="num-cell">${i + 1}</td>
              <td><input type="checkbox" class="exchange-check" data-idx="${i}"></td>
              <td class="clickable" onclick="goExchange('${esc(pn)}','${esc(syasyu)}')">${esc(pn)}</td>
              <td>${esc(r.JOKEN_LABEL || r.JOKEN || "")}</td>
              <td>${esc(r.JYOUKEN_IMI || "")}</td>
              <td>${esc(r.REFFLG || "")}</td>
              <td class="clickable" onclick="goExchange('${esc(pn)}','${esc(syasyu)}')">${esc(pn)}</td>
              <td>${esc(r.QUANTITY || "")}</td>
              <td>${esc(r.QUANTITY || "")}</td>
              <td>${esc(r.PARTS_NAME || "")}</td>
              <td>${esc(r.PARTS_CODE || "")}</td>
              <td>${esc(r.TEKIYOU || "")}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
    html += `<button class="btn secondary est-add" id="exchange-estimate-btn" style="margin-top:8px;">見積へ (選択行)</button>`;
    html += '</div></div>';
    el.innerHTML = html;
    const estBtn = document.getElementById("exchange-estimate-btn");
    if (estBtn) {
      estBtn.addEventListener("click", () => {
        const checks = document.querySelectorAll("#exchange-results .exchange-check:checked");
        if (!checks.length) { toast("交換する部品を選択してください"); return; }
        const swap = (document.querySelector('input[name="exchange-type"]:checked') || {}).value === "swap";
        checks.forEach((c) => {
          const r = rows[parseInt(c.dataset.idx)];
          if (!r) return;
          const pn = r.EXCHANGE_PARTS_NUMBER || r.VIEW_PARTS_NUMBER || "";
          if (swap) {
            // 互換元部品と入替え — replace the exchange-source row
            const idxExisting = EST.items.findIndex((it) => it.parts_number === r.VIEW_PARTS_NUMBER);
            if (idxExisting >= 0) EST.items.splice(idxExisting, 1);
          }
          addEstimate(pn, r.PARTS_NAME || "", r.QUANTITY || 1, "", syasyu, "");
        });
        activateTab('basket');
      });
    }
  } catch (e) {
    el.innerHTML = `<div class="card"><p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p></div>`;
  }
});

window.goExchange = function (partsNum, syasyu) {
  activateTab('exchange');
  document.getElementById("exchange-parts-num").value = partsNum;
  if (syasyu) document.getElementById("exchange-syasyu").value = syasyu;
  document.getElementById("exchange-search-btn").click();
};

// ---------------------------------------------------------------------------
// Tab 5: Parts Name Search
// ---------------------------------------------------------------------------
document.getElementById("ps-search-btn").addEventListener("click", async () => {
  const syasyu = document.getElementById("ps-syasyu").value.trim();
  // SEPCW0340 ワード１－３
  const words = ["ps-word-1", "ps-word-2", "ps-word-3"]
    .map((id) => (document.getElementById(id) || {}).value || "")
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!syasyu) { toast("車種コードを入力してください"); return; }
  if (!words.length) { toast("ワード１〜３のいずれかを入力してください"); return; }
  const el = document.getElementById("ps-results");
  el.innerHTML = '<div class="card"><div class="loading"></div> 検索中…</div>';
  try {
    // 静的配布: staticApi 直叩き (parts/search ワードは repeat param のため
    // core api() の URLSearchParams 直列化を経由しない)
    const rows = await staticApi("parts/search", { syasyu, words });
    if (!rows.length) {
      el.innerHTML = '<div class="card"><p>該当なし</p></div>';
      return;
    }
    el.innerHTML = `
      <div class="card">
        <h6 class="large-text">検索結果 (${rows.length}件)</h6>
        <table>
          <thead><tr><th>部品番号</th><th>部品名</th><th>図番号</th><th>NUM</th><th>適用</th><th>備考</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td class="clickable" onclick="goExchange('${esc(r.PARTS_NUMBER)}','${esc(syasyu)}')">${esc(r.PARTS_NUMBER)}</td>
                <td>${esc(r.PARTS_NAME || r.HYOUGEN1 || "")}</td>
                <td>${esc(r.FIG_NO || "")}</td>
                <td>${esc(r.FIG_NUM || "")}</td>
                <td>${esc(r.SAIYOU_YMD || "")}–${esc(r.HAISHI_YMD || "")}</td>
                <td>${esc(r.TEKIYOU || "")}</td>
                <td><button class="btn secondary est-add" onclick="addEstimate('${esc(r.PARTS_NUMBER)}','${esc(r.PARTS_NAME || r.HYOUGEN1 || "")}','1','','${esc(syasyu)}','${esc(r.FIG_NO || "")}')">見積に追加</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="card"><p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p></div>`;
  }
});

// ---------------------------------------------------------------------------
// Tab 6: Parts Code — codes, fuzzy, figures, fig-count, catalog
// ---------------------------------------------------------------------------
document.getElementById("pc-search-btn").addEventListener("click", () => {
  const q = document.getElementById("pc-prefix").value.trim();
  // one input drives both: contains % → fuzzy, otherwise prefix match
  const el = document.getElementById("pc-results");
  el.innerHTML = '<div class="loading"></div> 検索中…';
  runPartsCodes(q.includes("%") ? "fuzzy" : "prefix");
});

// --- pc/pcf merged into one handler (pc-search-btn: prefix empty=list all,
// pattern with % or empty = fuzzy against parts/codes-fuzzy) ---
async function runPartsCodes(mode) {
  const syasyu = document.getElementById("pc-syasyu").value.trim();
  if (!syasyu) { toast("車種コードを入力してください"); return; }
  const q = document.getElementById("pc-prefix").value.trim();
  const el = document.getElementById("pc-results");
  el.innerHTML = '<div class="loading"></div> 検索中…';
  try {
    const path = /%/.test(q) ? "parts/codes-fuzzy" : "parts/codes";
    const rows = await api(path, { syasyu, parts_code_prefix: q.replace(/%/g, "") });
    el.innerHTML = rows.length
      ? `<p class="small-text">${rows.length}件</p><div class="table-scroll"><table>
        <thead><tr><th>PARTS_CODE</th><th>名称</th><th>FIG</th><th>複数図</th></tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <td class="clickable" onclick="goFigures('${esc(syasyu)}','${esc(r.PARTS_CODE)}')">${esc(r.PARTS_CODE)}</td>
          <td>${esc(r.PARTS_CODE_NAME || "")}</td>
          <td class="clickable" onclick="goDiagram('${esc(syasyu)}','${esc(r.FIG_NO || "")}','01')">${esc(r.FIG_NO || "")}</td>
          <td>${esc(r.HAS_MULTI || "")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="dim">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
}
window.goFigures = async function (syasyu, code) {
  document.getElementById("pf-syasyu").value = syasyu;
  document.getElementById("pf-codes").value = code;
  document.getElementById("pf-search-btn").click();
};

// pf: single handler — codes list (comma ok) → figures + count columns
document.getElementById("pf-search-btn").addEventListener("click", async () => {
  const syasyu = document.getElementById("pf-syasyu").value.trim();
  const codes = document.getElementById("pf-codes").value.trim();
  if (!syasyu || !codes) { toast("車種コードと部品コードを入力してください"); return; }
  const el = document.getElementById("pf-results");
  el.innerHTML = '<div class="loading"></div> 検索中…';
  try {
    const [figRows, cntRows] = await Promise.all([
      api("parts/fig-count", { syasyu, parts_codes: codes }),
      Promise.all(codes.split(",").map((c) => api("parts/figures", { syasyu, parts_code: c.trim() }))),
    ]);
    const cnt = Object.fromEntries(figRows.map((r) => [r.PARTS_CODE, r.FIG_COUNT]));
    const flat = [];
    cntRows.forEach((figs, i) => {
      const code = codes.split(",")[i].trim();
      (figs || []).forEach((r) => flat.push({ CODE: code, ...r }));
    });
    el.innerHTML = flat.length
      ? `<div class="table-scroll"><table><thead><tr><th>部品コード</th><th>FIG_NO</th><th>FIG名称</th><th>図数</th></tr></thead><tbody>
        ${flat.map((r) => `<tr>
          <td>${esc(r.CODE)}</td>
          <td class="clickable" onclick="goDiagram('${esc(syasyu)}','${esc(r.FIG_NO)}','01')">${esc(r.FIG_NO)}</td>
          <td>${esc(r.FIG_NAME || "")}</td>
          <td>${esc(cnt[r.CODE] ?? "")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="dim">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

document.getElementById("cat-search-btn").addEventListener("click", async () => {
  // defaults from the current VIN context (絞込検索の主用途: 車両適合の候補一覧)
  const ctx = getVinContext() || {};
  const syasyu = document.getElementById("cat-syasyu").value.trim() || ctx.syasyu || "";
  const code = document.getElementById("cat-code").value.trim();
  if (!syasyu || !code) { toast("部品コード (車種は空欄でVINコンテキストを使用) を入力してください"); return; }
  const el = document.getElementById("cat-results");
  el.innerHTML = '<div class="loading"></div> 検索中…';
  try {
    const params = {
      syasyu, parts_code: code,
      fig_no: document.getElementById("cat-fig-no").value.trim() || undefined,
      // VINコンテキストがあれば原版 PartsLogic 同様に絞込 (nenkai/色/VIN採用・廃止年月)
      ...(() => {
        return (ctx && ctx.vinBefore && ctx.syasyu === syasyu) ? {
          vin_before: ctx.vinBefore,
          vin_after: ctx.vinAfter,
          trim_cd: ctx.trimCd || undefined,
          destination: ctx.destination || undefined,
          option_code: ctx.optionCode || undefined,
          bd_seisan_ymd: ctx.bd || undefined,
          eg_seisan_ymd: ctx.eg || undefined,
          tm_seisan_ymd: ctx.tm || undefined,
          syaryo_model: ctx.model || undefined,
          syaryo_color_cd: ctx.colorCode || undefined,
          model_positions: ctx.modelPosition ? [parseInt(ctx.modelPosition, 10)] : undefined,
        } : {};
      })(),
    };
    const rows = await api("parts/catalog", params);
    el.innerHTML = rows.length
      ? `<p>${rows.length}件</p><table>
        <thead><tr><th>No</th><th>部品番号</th><th>部品名</th><th>数量</th><th>適用</th><th>備考</th><th></th></tr></thead>
        <tbody>
          ${rows.map((p, i) => `<tr>
            <td>${i + 1}</td>
            <td class="clickable" onclick="goExchange('${esc(p.PARTS_NUMBER)}','${esc(syasyu)}')">${esc(p.PARTS_NUMBER)}</td>
            <td>${esc(p.PARTS_NAME || "")}</td>
            <td>${esc(p.QUANTITY || "")}</td>
            <td>${esc(p.SAIYOU_YMD || "")}–${esc(p.HAISHI_YMD || "")}</td>
            <td>${esc(p.TEKIYOU || p.HYOUGEN1 || "")}</td>
            <td><button class="btn secondary est-add" onclick="addEstimate('${esc(p.PARTS_NUMBER)}','${esc(p.PARTS_NAME || "")}','${esc(p.QUANTITY || 1)}','','${esc(syasyu)}','${esc(document.getElementById("cat-fig-no").value.trim() || "")}')">追加</button></td>
          </tr>`).join("")}
        </tbody></table>`
      : '<p style="color:var(--outline)">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

// Cross-tab: jump to diagram
window.goDiagram = function (syasyu, figNo, figNum) {
  activateTab('diagram');
  if (state.selectedModel !== syasyu) {
    selectDiagModel(syasyu).then(() => {
      setTimeout(() => loadDiagram(syasyu, figNo, figNum), 200);
    });
  } else {
    loadDiagram(syasyu, figNo, figNum);
  }
};

// ---------------------------------------------------------------------------
// Symbols (記号・略号) — syasyu via input / VIN context fallback
// ---------------------------------------------------------------------------
function symSyasyu() {
  return (document.getElementById("sym-syasyu") || {}).value?.trim()
    || (getVinContext() || {}).syasyu || "";
}

document.getElementById("kr-search-btn").addEventListener("click", async () => {
  const syasyu = symSyasyu();
  if (!syasyu) { toast("車種コード (またはVINコンテキスト) を入力してください"); return; }
  const input = document.getElementById("kr-input").value.trim() || undefined;
  const el = document.getElementById("kr-results");
  el.innerHTML = '<div class="loading"></div> 取得中…';
  try {
    const rows = await api("kigo-ryakugo", { syasyu, input });
    el.innerHTML = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>No</th><th>記号</th><th>意味</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td class="num-cell">${i + 1}</td><td>${esc(r.KIGOU)}</td><td>${esc(r.IMI || r.RYAKUGO || r.HYOUJI || "")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="dim">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

document.getElementById("em-search-btn").addEventListener("click", async () => {
  const syasyu = symSyasyu();
  if (!syasyu) { toast("車種コード (またはVINコンテキスト) を入力してください"); return; }
  const group = document.getElementById("em-group").value.trim() || "%";
  const el = document.getElementById("em-results");
  el.innerHTML = '<div class="loading"></div> 取得中…';
  try {
    const rows = await api("emokuji", { syasyu, group });
    el.innerHTML = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>GROUP</th><th>EMOKUJI</th><th>NAME</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.GROUP || r.EMOKUJI_GROUP || "")}</td><td>${esc(r.EMOKUJI || "")}</td><td>${esc(r.NAME || r.FIG_NAME || r.EMOKUJI_NAME || "")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="dim">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

// ---------------------------------------------------------------------------
// Tab 8: Interchange & Applicable & Price
// ---------------------------------------------------------------------------
document.getElementById("ic-search-btn").addEventListener("click", async () => {
  const partsNum = document.getElementById("ic-parts-num").value.trim();
  if (!partsNum) { toast("部品番号を入力してください"); return; }
  const icEl = document.getElementById("ic-interchange");
  const mdEl = document.getElementById("ic-models");
  icEl.innerHTML = '<div class="card"><div class="loading"></div> 検索中…</div>';
  mdEl.innerHTML = "";
  try {
    const [icRows, mdRows] = await Promise.all([
      api(`parts/vehicle-dbable/${partsNum}`),
      api(`parts/models/${partsNum}`),
    ]);
    icEl.innerHTML = icRows.length ? `
      <div class="card">
        <h6 class="large-text">互換部品 (${icRows.length}件)</h6>
        <table>
          <thead><tr><th>No</th><th>部品番号</th><th>互換情報</th><th>互換部品番号</th><th>SUBARU_FLG</th></tr></thead>
          <tbody>
            ${icRows.map((r, i) => `<tr><td class="num-cell">${i + 1}</td><td>${esc(r.PARTS_NUMBER)}</td><td>${esc(r.GOKAN_KUBUN || "")}</td><td class="clickable" onclick="goExchange('${esc(r.GOKAN_PARTS_NUMBER || r.PARTS_NUMBER)}','')">${esc(r.GOKAN_PARTS_NUMBER || "")}</td><td>${esc(r.SUBARU_FLG || "")}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>` : '<div class="card"><p>互換部品なし</p></div>';
    mdEl.innerHTML = mdRows.length ? `
      <div class="card">
        <h6 class="large-text">適応車種 (${mdRows.length}件)</h6>
        <table>
          <thead><tr><th>No</th><th>車種コード</th><th>FIG-NO</th><th>採用 - 廃止 &amp; 年改</th><th>適用車種</th><th>適用オプション</th><th>摘要</th><th>差異</th></tr></thead>
          <tbody>
            ${mdRows.map((r, i) => `<tr><td class="num-cell">${i + 1}</td><td class="clickable" onclick="goModelsTab('${esc(r.SYASYU_CD || r.CODE || "")}')">${esc(r.SYASYU_CD || r.SHASHUCTLG || r.CODE || "")}</td><td>${esc(r.FIG_NO || "")}</td><td>${esc(r.SAIHAI_YM || (r.SAIYO_YM || "") + " - " + (r.HAISHI_YM || ""))}</td><td>${esc(r.KATASHIKI || r.NAME || "")}</td><td>${esc(r.HYOUGEN || "")}</td><td>${esc(r.TEKIYOU || "")}</td><td>${esc(r.ILLUST_KIGOU || "")}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>` : '<div class="card"><p>適用車種なし</p></div>';
  } catch (e) {
    icEl.innerHTML = `<div class="card"><p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p></div>`;
  }
});

document.getElementById("ic-price-btn").addEventListener("click", async () => {
  const partsNum = document.getElementById("ic-parts-num").value.trim();
  if (!partsNum) { toast("部品番号を入力してください"); return; }
  const el = document.getElementById("ic-price");
  el.innerHTML = '<div class="card"><div class="loading"></div> 取得中…</div>';
  try {
    const [priceRes, nameRes] = await Promise.allSettled([
      api(`parts/price/${partsNum}`),
      api(`parts/name/${partsNum}`),
    ]);
    let html = '<div class="card"><h6 class="large-text">価格・名称</h6><table>';
    if (priceRes.status === "fulfilled") {
      html += `<tr><th>部品番号</th><td>${esc(priceRes.value.parts_number)}</td></tr>`;
      html += `<tr><th>価格</th><td>${esc(priceRes.value.price)}</td></tr>`;
    } else {
      html += `<tr><th>価格</th><td style="color:var(--outline)">取得失敗</td></tr>`;
    }
    if (nameRes.status === "fulfilled") {
      html += `<tr><th>部品名</th><td>${esc(nameRes.value.parts_name)}</td></tr>`;
    } else {
      html += `<tr><th>部品名</th><td style="color:var(--outline)">取得失敗</td></tr>`;
    }
    html += '</table></div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<div class="card"><p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p></div>`;
  }
});

window.goModelsTab = function (code) {
  activateTab('misc');
  if (code) setTimeout(() => selectModel(code), 100);
};

// ---------------------------------------------------------------------------
// Tab 9: Katashiki / Model / Nenkai / Color-Trim
// ---------------------------------------------------------------------------
document.getElementById("kt-search-btn").addEventListener("click", async () => {
  const katashiki = document.getElementById("kt-katashiki").value.trim();
  if (!katashiki) { toast("型式を入力してください"); return; }
  const el = document.getElementById("kt-results");
  el.innerHTML = '<div class="loading"></div> 検索中…';
  try {
    const rows = await api("vehicle/katashiki", { katashiki });
    // 車種単位に集約 (類別番号・MODEL_POSITION ごとの行は同一車種の重複表示になるため)
    const bySyasyu = new Map();
    rows.forEach((r) => {
      const s = r.SHASHUCTLG || r.SYASYU_CD || "";
      if (!bySyasyu.has(s)) bySyasyu.set(s, { sekkei: new Set(), saihai: new Set() });
      const e = bySyasyu.get(s);
      if (r.SEKKEI_KATASHIKI) e.sekkei.add(r.SEKKEI_KATASHIKI);
      if (r.SAIHAI_YM) e.saihai.add(r.SAIHAI_YM);
    });
    el.innerHTML = bySyasyu.size
      ? `<div class="table-scroll"><table><thead><tr><th>車種</th><th>設計型式 (SEKKEI_KATASHIKI)</th><th>採用 - 廃止</th></tr></thead><tbody>
        ${[...bySyasyu].map(([s, e]) => `<tr>
          <td class="clickable" onclick="goModelsTab('${esc(s)}')">${esc(s)}</td>
          <td>${esc([...e.sekkei].sort().join(", "))}</td>
          <td>${esc([...e.saihai].sort().join(" / "))}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p style="color:var(--outline)">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

document.getElementById("md-search-btn").addEventListener("click", async () => {
  const model = document.getElementById("md-model").value.trim();
  if (!model) { toast("モデルコードを入力してください"); return; }
  const el = document.getElementById("md-results");
  el.innerHTML = '<div class="loading"></div> 検索中…';
  try {
    const rows = await api("vehicle/model", { model });
    el.innerHTML = rows.length
      ? `<table><thead><tr><th>車種</th><th>VIN_BEFORE</th><th>VIN_AFTER</th><th>TRIM_CD</th><th>DESTINATION</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.SHASHUCTLG || r.SYASYU_CD || "")}</td><td>${esc(r.VIN_BEFORE)}</td><td>${esc(r.VIN_AFTER)}</td><td>${esc(r.TRIM_CD)}</td><td>${esc(r.DESTINATION)}</td></tr>`).join("")}
        </tbody></table>`
      : '<p style="color:var(--outline)">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

// mdl (model detail) removed — model/list + nengetsu cover the use case.

document.getElementById("ml-search-btn").addEventListener("click", async () => {
  const syasyu = document.getElementById("ml-syasyu").value.trim()
    || (getVinContext() || {}).syasyu || "";
  if (!syasyu) { toast("車種コード (またはVINコンテキスト) を入力してください"); return; }
  const el = document.getElementById("ml-results");
  el.innerHTML = '<div class="loading"></div> 取得中…';
  try {
    const rows = await api("model/list", { syasyu });
    el.innerHTML = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>MODEL_POSITION</th><th>MODEL</th><th>SAIYOU_YM</th><th>HAISHI_YM</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.MODEL_POSITION || "")}</td><td>${esc(r.MODEL || "")}</td><td>${esc(r.SAIYOU_YM || "")}</td><td>${esc(r.HAISHI_YM || "")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="dim">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

document.getElementById("ng-search-btn").addEventListener("click", async () => {
  const syasyu = document.getElementById("ml-syasyu").value.trim()
    || (getVinContext() || {}).syasyu || "";
  const nenkai = document.getElementById("ng-nenkai").value.trim();
  if (!syasyu || !nenkai) { toast("年改コード (車種は空欄でVINコンテキスト/上欄共有) を入力してください"); return; }
  const el = document.getElementById("ng-results");
  el.innerHTML = '<div class="loading"></div> 取得中…';
  try {
    const rows = await api("nengetsu-by-nenkai", { syasyu, nenkai });
    el.innerHTML = rows.length
      ? `<table><thead><tr><th>NENKAI</th><th>SAIYO_YMD</th><th>HAISHI_YMD</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.NENKAI || "")}</td><td>${esc(r.SAIYO_YMD || "")}</td><td>${esc(r.HAISHI_YMD || "")}</td></tr>`).join("")}
        </tbody></table>`
      : '<p class="dim">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

// ct (color/trim-count) removed — 内部絞込のみに利用され直接UI需要なし.

// ---------------------------------------------------------------------------
// Tab 10: Overseas & Misc — merged overseas dictionary lookup
// ---------------------------------------------------------------------------

document.getElementById("il-search-btn").addEventListener("click", async () => {
  const syasyu = document.getElementById("il-syasyu").value.trim()
    || (getVinContext() || {}).syasyu || "";
  if (!syasyu) { toast("車種コード (またはVINコンテキスト) を入力してください"); return; }
  const el = document.getElementById("il-results");
  el.innerHTML = '<div class="loading"></div> 取得中…';
  try {
    const rows = await api("illust/list", {
      syasyu,
      saiyou_ym: "000000",
      haishi_ym: "999999",
      fig_no: document.getElementById("il-fig-no").value.trim() || undefined,
    });
    el.innerHTML = rows.length
      ? `<p class="small-text">${rows.length}件</p><div class="table-scroll"><table><thead><tr><th>FIG_NO</th><th>FIG_NUM</th><th>FIG_GROUP</th><th>FIG_NAME</th><th>合冊</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="clickable" onclick="goDiagram('${esc(syasyu)}','${esc(r.FIG_NO)}','${esc(r.FIG_NUM || "01")}')">${esc(r.FIG_NO)}</td><td>${esc(r.FIG_NUM || "")}</td><td>${esc(r.FIG_GROUP || "")}</td><td>${esc(r.FIG_NAME || "")}</td><td>${esc(r.GOKAN_FLG || "")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="dim">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

document.getElementById("sy-search-btn").addEventListener("click", async () => {
  const vb = document.getElementById("sy-vin-before").value.trim();
  const saiyou = document.getElementById("sy-saiyou").value.trim();
  const haishi = document.getElementById("sy-haishi").value.trim();
  if (!vb || !saiyou || !haishi) { toast("VIN_BEFORE, SAIYO_YM, HAISHI_YMを入力してください"); return; }
  const el = document.getElementById("sy-results");
  el.innerHTML = '<div class="loading"></div> 計算中…';
  try {
    const res = await api("saihai-ym", {
      vin_before: vb,
      saiyou_ym: saiyou,
      haishi_ym: haishi,
      fig_no: document.getElementById("sy-fig-no").value.trim() || undefined,
    });
    el.innerHTML = `<table>
      <tr><th>採用YM</th><td>${esc(res.saiyou_ym)}</td></tr>
      <tr><th>廃止YM</th><td>${esc(res.haishi_ym)}</td></tr>
      <tr><th>採用YMD</th><td>${esc(res.saiyou_ymd)}</td></tr>
      <tr><th>廃止YMD</th><td>${esc(res.haishi_ymd)}</td></tr>
      <tr><th>年改</th><td>${esc(res.nenkai)}</td></tr>
    </table>`;
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

// fgi + fgt merged — one handler: FIG_GROUP(S) comma separated
document.getElementById("fgi-search-btn").addEventListener("click", async () => {
  const syasyu = document.getElementById("fgi-syasyu").value.trim()
    || (getVinContext() || {}).syasyu || "";
  const groups = document.getElementById("fgi-groups").value.trim();
  if (!syasyu || !groups) { toast("FIG_GROUP (車種は空欄でVINコンテキスト) を入力してください"); return; }
  const el = document.getElementById("fgi-results");
  el.innerHTML = '<div class="loading"></div> 取得中…';
  try {
    const rows = await api("fig-group/targets", { syasyu, fig_groups: groups });
    el.innerHTML = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>FIG_GROUP</th><th>FIG_NO</th><th>FIG_NAME</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.FIG_GROUP || "")}</td><td class="clickable" onclick="goDiagram('${esc(syasyu)}','${esc(r.FIG_NO)}','01')">${esc(r.FIG_NO)}</td><td>${esc(r.FIG_NAME || "")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="dim">該当なし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

document.getElementById("vi-search-btn").addEventListener("click", async () => {
  const el = document.getElementById("vi-results");
  el.innerHTML = '<div class="loading"></div> 取得中…';
  try {
    const rows = await api("version-info");
    el.innerHTML = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>AREA_CD</th><th>PRICE_VERSION</th><th>DVD_VERSION</th><th>DVD_CREATE_DATE</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.AREA_CD)}</td><td>${esc(r.PRICE_VERSION || "")}</td><td>${esc(r.DVD_VERSION || "")}</td><td>${esc(r.DVD_CREATE_DATE || "")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="dim">データなし</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p>`;
  }
});

// hidden inputs are fixed (国内/JPN) — no change handlers needed

// --- VIN context bar clear ---
document.getElementById("ctx-clear-btn").addEventListener("click", () => {
  if (!getVinContext()) { toast("車両コンテキストは未設定です"); return; }
  clearVinContext();
  toast("車両コンテキストをクリアしました");
  const el = document.getElementById("ctx-elements");
  if (el) el.innerHTML = "";
});


// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadModels();

