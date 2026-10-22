// ---------------------------------------------------------------------------
// VIN context — the EPC core workflow (VIN入力 → 充填 → 展開図 → 部品選択 → 品番引く)
// ---------------------------------------------------------------------------
const VIN_CTX_KEY = "subaru-epc-vin-context";

function getVinContext() {
  try {
    return JSON.parse(sessionStorage.getItem(VIN_CTX_KEY)) || null;
  } catch (e) {
    return null;
  }
}

function saveVinContext(ctx) {
  sessionStorage.setItem(VIN_CTX_KEY, JSON.stringify(ctx));
  renderVinContext();
  // 車両確定の時点で展開図側にも充填 (展開図アコーディオンを開くと即選択済み)
  applyVinContextToDiagram();
}

function clearVinContext() {
  sessionStorage.removeItem(VIN_CTX_KEY);
  renderVinContext();
}

// Fill the vehicle-context card (editable-looking readonly text fields —
// 原版 SEPCW0000 検索条件ヘッダ流儀: 情報は車両検索タブ内で確認できる) + 展開図へ即座に充填
function renderVinContext() {
  const cardEl = document.getElementById("ctx-card");
  if (!cardEl) return;
  const ctx = getVinContext();
  if (!ctx) { cardEl.classList.add("hidden"); return; }
  cardEl.classList.remove("hidden");
  const fmtYmd = (v) => (v && v.length === 8 ? `${v.slice(0,4)}/${v.slice(4,6)}/${v.slice(6,8)}` : (v || ""));
  const set = (id, v) => { const inp = document.getElementById(id); if (inp) inp.value = v || ""; };
  set("ctx-syasyu", `${ctx.syasyu || ""} ${ctx.syasyuName && ctx.syasyuName !== ctx.syasyu ? ctx.syasyuName : ""}`.trim());
  set("ctx-vin", `${ctx.vinBefore || ""}-${ctx.vinAfter || ""}`);
  set("ctx-model", ctx.model);
  set("ctx-katashiki", ctx.katashiki);
  set("ctx-trim", ctx.trim || ctx.trimCd);
  set("ctx-color", ctx.colorName && ctx.colorName.includes(ctx.colorCode) ? ctx.colorName
    : ctx.colorName ? `${ctx.colorName} (${ctx.colorCode})` : ctx.colorCode);
  set("ctx-nenkai", ctx.nenkai);
  set("ctx-bd", fmtYmd(ctx.bd));
  set("ctx-eg", fmtYmd(ctx.eg));
  set("ctx-tm", fmtYmd(ctx.tm));
  set("ctx-option", ctx.optionCode);
  set("ctx-dest", ctx.destination);
  renderCtxElements(ctx);
  document.getElementById("veh-sub").textContent =
    `${ctx.syasyu || ""} ${ctx.vinBefore || ""}-${ctx.vinAfter || ""}`.trim();
}

// 特徴記号 (elements) — M_SEKKEI_KATASHIKI の KIGOU_1..23 を kubun 名で整形
// (原版 SEPCW0000 の elements 行: ｸﾞﾚｰﾄﾞ=AT ﾐﾂｼﾞｬ=5MT のように区分名=記号を並べる)
async function renderCtxElements(ctx) {
  const el = document.getElementById("ctx-elements");
  if (!el) return;
  if (!ctx || !ctx.syasyu || ctx.modelPosition == null) { el.innerHTML = ""; return; }
  try {
    const m = await getCatalogManifest(ctx.syasyu);
    const spec = m.syaryoSpec || {};
    const pos = (spec.positions || []).find(
      (p) => String(p.position) === String(ctx.modelPosition));
    if (!pos) { el.innerHTML = ""; return; }
    const kubunNames = spec.kubunNames || {};
    // 他の ctx-* と同じタイトル付きテキストボックス (Beer CSS field label border)
    const fields = (pos.kigou || [])
      .map((k, i) => k ? { name: kubunNames[String(i + 1)] || `区分${i + 1}`, kigou: k } : null)
      .filter(Boolean)
      .map((x) => `<div class="field label border"><input type="text" readonly value="${esc(x.kigou)}"><label>${esc(x.name)}</label></div>`)
      .join("");
    el.innerHTML = fields;
  } catch (e) { el.innerHTML = ""; }
}

// VIN context set → 展開図アコーディオンをその車両で充填 (展開図を開くボタン不要でも選べる状態に)
function applyVinContextToDiagram() {
  const ctx = getVinContext();
  if (!ctx || !ctx.syasyu) return;
  if (state.selectedModel !== ctx.syasyu) {
    selectDiagModel(ctx.syasyu);
  }
}


// ---------------------------------------------------------------------------
// Tab 1: Car Models
// ---------------------------------------------------------------------------
async function loadModels() {
  try {
    const rows = await api("shashu");
    state.models = rows;
    renderModelList(rows);
  } catch (e) {
    toast("車種一覧の取得に失敗: " + e.message);
  }
}

function renderModelList(rows) {
  const el = document.getElementById("model-list");
  if (!rows.length) {
    el.innerHTML = '<div class="item" style="color:var(--outline)">該当なし</div>';
    return;
  }
  // SEPCW0030 収録車種一覧 — columns: No / 車種名 / 採用年月-廃止年月 / 車種コード / 代表
  const saihai = (r) => {
    const from = r.SAIYO_YM || "";
    const to = !r.HAISHI_YM || r.HAISHI_YM === "999999" ? "" : r.HAISHI_YM;
    return to ? `${from} - ${to}` : from;
  };
  el.innerHTML = `
    <table class="model-table">
      <thead><tr><th>No</th><th>車種名</th><th>採用年月-廃止年月</th><th>車種コード</th><th>代表</th></tr></thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr class="model-row" data-code="${esc(r.CODE)}">
            <td class="num-cell">${i + 1}</td>
            <td>${esc(r.NAME || "")}</td>
            <td>${esc(saihai(r))}</td>
            <td class="code">${esc(r.CODE)}</td>
            <td>${esc(r.DAIHYO || "")}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  el.querySelectorAll(".model-row").forEach((row) => {
    row.addEventListener("click", () => selectModel(row.dataset.code));
  });
}

document.getElementById("model-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toUpperCase();
  if (!q) return renderModelList(state.models);
  const filtered = state.models.filter(
    (m) =>
      (m.CODE || "").toUpperCase().includes(q) ||
      (m.NAME || "").toUpperCase().includes(q)
  );
  renderModelList(filtered);
});

async function selectModel(code) {
  document.querySelectorAll("#model-list .model-row").forEach((el) => {
    el.classList.toggle("selected", el.dataset.code === code);
  });
  state.selectedModel = code;
  const detail = document.getElementById("model-detail");
  detail.innerHTML = '<div class="card"><div class="loading"></div> 読み込み中…</div>';
  try {
    const [info, nenkai, maint] = await Promise.all([
      api(`shashu/${code}`),
      api("nenkai", { syasyu: code }),
      api("maintenance", { syasyu: code }),
    ]);
    let html = `
      <div class="card">
        <h5>${esc(code)} — ${esc(info[0]?.NAME || "")}</h5>
        <table>
          <tr><th>車種コード</th><td>${esc(info[0]?.CODE)}</td><th>SUBARU_FLG</th><td>${esc(info[0]?.SUBARU_FLG)}</td></tr>
          <tr><th>車種名</th><td>${esc(info[0]?.NAME || "")}</td><th>採用YM</th><td>${esc(info[0]?.SAIYO_YM)}</td></tr>
          <tr><th>廃止YM</th><td>${esc(info[0]?.HAISHI_YM)}</td><th>エリア</th><td>${esc(info[0]?.AREA_CD)}</td></tr>
        </table>
      </div>`;
    if (nenkai.length) {
      html += `
        <div class="card">
          <h6>年改一覧</h6>
          ${tableHTML(["年改", "採用年月日", "廃止年月日"], nenkai, (n, ci) =>
            ci === 0 ? esc(n.NENKAI) : ci === 1 ? esc(n.SAIYO_YMD) : esc(n.HAISHI_YMD)
          )}
        </div>`;
    }
    if (maint.length) {
      const withNum = maint.filter((m) => m.PARTS_NUMBER);
      html += `
        <div class="card">
          <h6>メンテナンス部品</h6>
          <table>
            <thead><tr><th>部品番号</th><th>部品名</th><th></th></tr></thead>
            <tbody>
              ${withNum.slice(0, 50).map((m) => `
                <tr>
                  <td class="clickable" onclick="goExchange('${esc(m.PARTS_NUMBER)}','${esc(code)}')">${esc(m.PARTS_NUMBER)}</td>
                  <td>${esc(m.PARTS_NAME)}</td>
                  <td><button class="border small" onclick="addEstimate('${esc(m.PARTS_NUMBER)}','${esc(m.PARTS_NAME || "")}','${esc(m.QUANTITY || 1)}','','${esc(code)}','')">追加</button></td>
                </tr>`).join("")}
            </tbody>
          </table>
          ${withNum.length > 50 ? `<p class="small-text dim" style="margin-top:8px;">(上位50件 / 全${withNum.length}件)</p>` : ""}
        </div>`;
    }
    detail.innerHTML = html;
  } catch (e) {
    detail.innerHTML = `<div class="card"><p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------------------
// Tab 2: VIN Search + Vehicle Count + Kirikae
// ---------------------------------------------------------------------------
document.getElementById("vin-search-btn").addEventListener("click", async () => {
  const vb = document.getElementById("vin-before").value.trim();
  const va = document.getElementById("vin-after").value.trim();
  if (!vb || !va) {
    toast("VIN_BEFORE と VIN_AFTER の両方を入力してください");
    return;
  }
  const el = document.getElementById("vin-results");
  el.innerHTML = '<div class="card"><div class="loading"></div> 検索中…</div>';
  try {
    const params = { vin_before: vb, vin_after: va };
    const oem = document.getElementById("vin-after-oem").value.trim();
    if (oem) params.vin_after_oem = oem;
    const rows = await api("vehicle/search", params);
    if (!rows.length) {
      el.innerHTML = '<div class="card"><p>該当車両なし</p></div>';
      return;
    }
    // VINから分かる情報が充填 — first hit becomes the vehicle context
    const hit = rows[0];
    const nenkaiYmd = (() => {
      // 原版 applySearchCondition: BD_SEISAN_YMD 末尾4桁 = 年改 (M.YMDD)
      const bd = hit.BD_SEISAN_YMD || "";
      return hit.VIEW_NENKAI || (bd.length === 8 ? bd.slice(4) : "");
    })();
    const ctx = {
      syasyu: hit.SYASYU_CD || hit.SHASHUCTLG || "",
      syasyuName: hit.SHASHUCTLG || "",
      vinBefore: hit.VIN_BEFORE || vb,
      vinAfter: hit.VIN_AFTER || va,
      trim: hit.TRIM_NM || hit.TRIM_CD || "",
      trimCd: hit.TRIM_CD || "",
      destination: hit.DESTINATION || "",
      bd: hit.BD_SEISAN_YMD || "",
      eg: hit.EG_SEISAN_YMD || "",
      tm: hit.TM_SEISAN_YMD || "",
      model: (hit.MODEL || "").trim(),
      katashiki: (hit.KATASHIKI_RUIBETSU || "").trim(),
      colorName: hit.COLOR_NM || "",
      colorCode: (hit.COLOR_CD || "").trim(),
      trimName: hit.TRIM_NM || "",
      shiyoPatternNo: (hit.SHIYO_PATTERN_NO || "").trim(),
      nenkai: nenkaiYmd,
      oemSyasyuCd: (hit.OEM_SYASYU_CD || "").trim(),
      optionCode: (hit.OPTION_CD || "").trim(),
      modelPosition: hit.MODEL_POSITION || hit.OPTION_POSITION || null,
    };
    saveVinContext(ctx);
    toast(`車両情報を設定: ${ctx.syasyu} — 展開図タブで部品を選択できます`);
    const ctxCard = `
      <div class="card">
        <h6 class="large-text">コンテキスト設定済み — ${esc(ctx.syasyu)} ${esc(ctx.katashiki || "")}</h6>
        <p class="small-text">展開図タブではこの車両の図グループ・図番号が自動的に絞り込まれます。
        「選択部品」タブの「品番引く」で車両適合する純正部品番号を一括引きます。</p>
        <button class="tonal" id="goto-diagram-btn">展開図を開く</button>
      </div>`;
    const resultCard = `
      <div class="card">
        <h6 class="large-text">検索結果 (${rows.length}件)</h6>
        <div class="table-scroll"><table>
          <thead>
            <tr><th>No</th><th>車種</th><th>車台番号</th><th>モデル</th><th>型式・類別</th><th>外装色</th><th>内装色</th><th>OPｺｰﾄﾞ</th><th>生産年月日 (B/E/T)</th></tr>
          </thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                <td class="num-cell">${i + 1}</td>
                <td>${esc(r.SHASHUCTLG || r.SYASYU_CD || "")}</td>
                <td>${esc(r.VIN_BEFORE)}-${esc(r.VIN_AFTER)}</td>
                <td>${esc((r.MODEL || "").trim())}</td>
                <td>${esc((r.KATASHIKI_RUIBETSU || "").trim())}</td>
                <td>${esc(r.COLOR_NM || "")}<span class="dim">${esc((r.COLOR_CD || "").trim())}</span></td>
                <td>${esc(r.TRIM_NM || "")}<span class="dim">${esc((r.TRIM_CD || "").trim())}</span></td>
                <td>${esc((r.OPTION_CD || "").trim())}</td>
                <td class="small-text">${esc(r.BD_SEISAN_YMD)}<br>${esc(r.EG_SEISAN_YMD)}<br>${esc(r.TM_SEISAN_YMD)}</td>
              </tr>`).join("")}
          </tbody>
        </table></div>
      </div>`;
    el.innerHTML = ctxCard + resultCard;
    const gotoBtn = document.getElementById("goto-diagram-btn");
    if (gotoBtn) gotoBtn.addEventListener("click", () => activateTab("diagram"));
  } catch (e) {
    el.innerHTML = `<div class="card"><p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p></div>`;
  }
});

// --- 型式・類別 / モデル検索 (SFAST0080D Basic search rows) ---


// SFAST0080D クリア



// ---------------------------------------------------------------------------
// Tab 3: Diagram — full EPC workflow: model → fig group → figure → point → parts
// ---------------------------------------------------------------------------
async function loadDiagModels() {
  if (!state.models.length) await loadModels();
  renderDiagModelList(state.models);
  // VIN context set → auto-filter the diagram to that vehicle
  const ctx = getVinContext();
  if (ctx && ctx.syasyu && state.selectedModel !== ctx.syasyu) {
    applyVinContextToDiagram();
  }
}

function renderDiagModelList(rows) {
  const el = document.getElementById("diag-model-list");
  el.innerHTML = rows.map((r) => `
    <div class="item" data-code="${esc(r.CODE)}">
      <span class="code">${esc(r.CODE)}</span>
      <span class="name">${esc(r.NAME || "")}</span>
    </div>`).join("");
  el.querySelectorAll(".item").forEach((item) => {
    item.addEventListener("click", () => selectDiagModel(item.dataset.code));
  });
}

document.getElementById("diag-model-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toUpperCase();
  const filtered = state.models.filter(
    (m) => (m.CODE || "").toUpperCase().includes(q) || (m.NAME || "").toUpperCase().includes(q)
  );
  renderDiagModelList(filtered);
});

async function selectDiagModel(code) {
  document.querySelectorAll("#diag-model-list .item").forEach((el) => {
    el.classList.toggle("selected", el.dataset.code === code);
  });
  state.selectedModel = code;
  state.currentFigGroup = null;
  document.getElementById("diag-model-sub").textContent = code;
  document.getElementById("diag-group-sub").textContent = "未選択";
  document.getElementById("diag-fig-sub").textContent = "未選択";
  document.getElementById("fig-group-list").innerHTML = '<div class="loading"></div>';
  document.getElementById("fig-list").innerHTML = "";
  document.getElementById("diagram-display").innerHTML =
    '<div class="card"><p style="color:var(--outline)">図グループを選択してください。</p></div>';
  try {
    // Fetch zentaizu regions (= fig groups with names)
    const zentaizu = await api("zentaizu", { syasyu: code });
    state.zentaizuRegions = zentaizu.regions || [];
    state.figGroups = state.zentaizuRegions;

    // Render fig groups
    const fgEl = document.getElementById("fig-group-list");
    if (state.figGroups.length) {
      fgEl.innerHTML = state.figGroups.map((r) => `
        <div class="item" data-fig-group="${esc(r.FIG_GROUP || "")}" data-fig-no="${esc(r.FIG_NO || "")}">
          <span class="code">${esc(r.FIG_GROUP || "")}</span>
          <span class="name">${esc(r.FIG_GROUP_NAME || "")}</span>
        </div>`).join("");
      fgEl.querySelectorAll(".item").forEach((item) => {
        item.addEventListener("click", () => selectFigGroup(code, item.dataset.figGroup, item.dataset.figNo));
      });
    } else {
      fgEl.innerHTML = '<div class="item" style="color:var(--outline)">図グループなし</div>';
    }
  } catch (e) {
    toast("図グループの取得に失敗: " + e.message);
  }
}

async function selectFigGroup(syasyu, figGroup, zentaizuFigNo) {
  document.querySelectorAll("#fig-group-list .item").forEach((el) => {
    el.classList.toggle("selected", el.dataset.figGroup === figGroup);
  });
  state.currentFigGroup = figGroup;
  const selGroup = state.figGroups.find((g) => g.FIG_GROUP === figGroup);
  document.getElementById("diag-group-sub").textContent =
    (selGroup && selGroup.FIG_GROUP_NAME) || figGroup;
  document.getElementById("diag-fig-sub").textContent = "未選択";
  document.getElementById("fig-list").innerHTML = '<div class="loading"></div>';
  document.getElementById("diagram-display").innerHTML =
    '<div class="card"><p style="color:var(--outline)">図番号を選択してください。</p></div>';
  try {
    // Get figures within this fig group
    const figs = await api("fig-group", { syasyu, fig_group: figGroup });
    const flEl = document.getElementById("fig-list");
    if (figs.length) {
      flEl.innerHTML = figs.map((f) => `
        <div class="item" data-fig-no="${esc(f.FIG_NO)}">
          <span class="code">${esc(f.FIG_NO)}</span>
          <span class="name">${esc(f.FIG_NAME || "")}</span>
        </div>`).join("");
      flEl.querySelectorAll(".item").forEach((item) => {
        item.addEventListener("click", () => loadDiagram(syasyu, item.dataset.figNo));
      });
    } else {
      // Fallback: use zentaizu fig_no directly
      if (zentaizuFigNo) {
        flEl.innerHTML = `<div class="item" data-fig-no="${esc(zentaizuFigNo)}">
          <span class="code">${esc(zentaizuFigNo)}</span>
        </div>`;
        flEl.querySelector(".item").addEventListener("click", () => loadDiagram(syasyu, zentaizuFigNo));
      } else {
        flEl.innerHTML = '<div class="item" style="color:var(--outline)">図番号なし</div>';
      }
    }
  } catch (e) {
    toast("図番号一覧の取得に失敗: " + e.message);
  }
}

async function loadDiagram(syasyu, figNo, figNum) {
  const display = document.getElementById("diagram-display");
  display.innerHTML = '<div class="card"><div class="loading"></div> 図面を読み込み中…</div>';
  state.diagramParts = null;
  state.pointParts = null;
  state.zoom = 1;
  state.zoomFit = true;

  // FIG_NUM (枚) 分岐: same FIG_NO 内で世代/グレード別に枚が分かれる (590-01=1997-99, -09/-10=後期 等)。
  // 未指定時は VIN コンテキストの生産年月に適合する枚を自動選択、無ければ 01。
  let figNums = [];
  try {
    // _staticPointNames を対象車種のものに確実化 (fit 判定で使う)
    await getCatalogManifest(syasyu);
    const list = await api("illust/list", { syasyu, fig_no: figNo, saiyou_ym: "000000", haishi_ym: "999999" });
    figNums = list.map((r) => ({
      num: r.FIG_NUM, saiyou: r.SAIYOU_YM, haishi: r.HAISHI_YM,
      note: r.ILLUST_NOTE || "", tekiyo: r.TEKIYO_SHASHU || "",
    }));
  } catch (e) { /* narrow-index なければ 01 のみ */ }
  if (!figNum) {
    const ctx = getVinContext();
    // 五感情報 (note に ｺﾞｶﾝｼﾞﾖｳﾎｳ) は選択肢から除く
    const info = figNums.filter((f) => !f.note.includes("ｺﾞｶﾝｼﾞﾖｳﾎｳ"));
    const ym = ctx && ctx.bd ? ctx.bd.slice(0, 6) : "";
    let fit = info;
    if (ym && ctx.syasyu === syasyu) {
      fit = info.filter((f) => f.saiyou <= ym && f.haishi >= ym);
    }
    if (!fit.length) fit = info;
    // 適合スコア: その枚のポイントがこの車両に何件解決するか (グレードが違う枚を避ける)。
    // 重いので先頭 ~400 ポイントまで (通常枚は <100)。
    let best = fit[fit.length - 1] || { num: "01" };
    let bestScore = -1;
    for (const f of fit.slice(0, 12)) {
      let score = 0;
      try {
        const chunk = await fetchStatic(`catalog/${syasyu}/fig-${figNo}.json`);
        const pts = chunk.points.filter((p) => (p.figNum || "01") === f.num);
        const pos = ctx.modelPosition ? parseInt(ctx.modelPosition, 10) : null;
        const seisan = ctx.vinBefore ? seisanYmdForFig(figNo, ctx) : "";
        for (const p of pts.slice(0, 400)) {
          const d = String(p.data || "");
          const k = String(p.kubun || "");
          if (k === "1" || k === "2" || (k !== "3" && k !== "4")) { score++; continue; }
          const mK = d.match(/^([^*]+)\*([A-Z0-9]+)$/);
          const code = k === "3" ? (mK ? mK[1] : d.replace(/\*+$/, ""))
            : (window._staticPointNames.codeOfNumber[d] || "");
          const rows = chunk.parts[code] || [];
          if (!rows.length) continue;
          if (k === "4" && !window._staticPointNames.partsNames[code]) continue;
          let ok = rows.some((r) => {
            const sai = String(r.SAIYOU_YMD || "00000000");
            const hai = String(r.HAISHI_YMD || "99999999");
            if (seisan && !(sai <= seisan && hai >= (seisan || "00000000").slice(0, 6) + "00")) return false;
            if (pos && !checkAppliedModel(r.APPLIED_MODEL, pos)) return false;
            return true;
          });
          if (ok) score++;
        }
      } catch (e) { /* keep score */ }
      if (score > bestScore) { bestScore = score; best = f; }
    }
    figNum = best.num;
  }

  state.selectedFig = { figNo, figNum, syasyu };
  state.figNumList = figNums;
  document.getElementById("diag-fig-sub").textContent = `${figNo}-${figNum || "01"}`;

  try {
    // Image URL (raw PNG from the static catalog)
    const imgUrl = `${STATIC_BASE}catalog/${syasyu}/img-${figNo}-${figNum}.png`;
    state.diagramPrint = { syasyu, figNo, figNum, imgUrl };

    // Points + exploded view + memo in parallel
    const [points, exploded, memo] = await Promise.all([
      api("illust/points", { syasyu, fig_no: figNo, fig_num: figNum }),
      api("illust/exploded-view", { syasyu, fig_no: figNo }).catch(() => []),
      api("illust/memo", { syasyu, fig_no: figNo }).catch(() => []),
    ]);

    const figName = (exploded[0]?.FIG_NAME) || "";
    const tokkiText = memo.map((m) => m.TOKKI || "").filter(Boolean).join("\n");
    const html = `
      <div class="diagram-head">
        <span><b>${esc(figNo)}-${esc(figNum || "01")}</b></span>
        <span>${esc(figName)}</span>
        <span class="dim">適用 ${esc(exploded[0]?.TEKIYO_SHASHU || syasyu)}</span>
        ${exploded[0]?.SAIHAI_YM ? `<span class="dim">${esc(exploded[0].SAIHAI_YM)}</span>` : ""}
      </div>
      <div class="diagram-toolbar" id="diag-toolbar">
        <button class="small-round border small" id="dz-in"><i>zoom_in</i></button>
        <button class="small-round border small" id="dz-out"><i>zoom_out</i></button>
        <button class="small-round border small" id="dz-fit"><i>image</i></button>
        ${figNums.filter((f) => !f.note.includes("ｺﾞｶﾝｼﾞﾖｳﾎｳ")).length > 1
          ? `<button class="small-round border small" id="dt-prev-num"><i>navigate_before</i>枚</button>
             <span class="small-text" style="align-self:center;">${esc(figNum)}/${esc(figNums[figNums.length-1].num)}</span>
             <button class="small-round border small" id="dt-next-num">枚<i>navigate_next</i></button>`
          : ""}
        ${memo.length ? '<button class="small-round border small" id="dz-tokki"><i>alert</i></button>' : ""}
      </div>
      <div class="diagram-container" id="diag-container">
        <div class="diagram-img-wrap" id="diag-img-wrap">
          <img id="diag-img" src="${imgUrl}" alt="diagram" />
        </div>
      </div>
      <div id="diag-tokki" style="${memo.length ? "" : "display:none;"}">
        <strong>イラスト特記</strong>
        <pre>${esc(tokkiText)}</pre>
      </div>
      <div class="input-number-bar" id="input-number">
        <label>個数</label>
        <input type="number" id="inputQty" min="0" max="999" value="" style="width:70px;">
        <input type="text" id="textPartsCode" readonly style="width:130px;">
        <input type="text" id="textPartsCodeName" readonly style="flex:1; min-width:140px;">
        <button class="fill" style="flex:0 0 auto" id="point-add-btn"><i>(add)</i>追加</button>
      </div>`;

    // Memo
    if (memo.length) {
      html += `
        <div class="card small-padding">
          <h6>特記</h6>
          <table>
            <thead><tr><th>FIG_NO</th><th>TOKKI</th></tr></thead>
            <tbody>
              ${memo.map((m) => `<tr><td>${esc(m.FIG_NO)}</td><td>${esc(m.TOKKI || "")}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>`;
    }

    display.innerHTML = html;

    // Add point markers after image loads — positioned in % so they track zoom
    const img = document.getElementById("diag-img");
    img.addEventListener("load", () => {
      const container = document.getElementById("diag-container");
      const wrap = document.getElementById("diag-img-wrap");
      const w = img.offsetWidth;
      const h = img.offsetHeight;
      const natW = img.naturalWidth || w;
      const natH = img.naturalHeight || h;
      state.diagramNat = { natW, natH };
      applyZoom();

      const ptsPx = points.map((pt) => ({
        pt,
        x: parseFloat(pt.END_X || pt.X || 0),
        y: parseFloat(pt.END_Y || pt.Y || 0),
      }));
      // 密集 repel: 22px マーカーが重なる点を縦方向に Sage 分散
      // (原版は点自体が小さめで重なりにくいが、WebUI の丸22pxでは重なるため補正)
      const minDist = 24; // px on natural size (マーカー直径+マージン)
      const sorted = [...ptsPx].sort((a, b) => a.y - b.y || a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        for (let j = 0; j < i; j++) {
          const dx = sorted[i].x - sorted[j].x;
          const dy = sorted[i].y - sorted[j].y;
          const d = Math.hypot(dx, dy);
          if (d < minDist && d > 0.001) {
            // 近い点を押しのける (i を下へ)
            sorted[i].y = sorted[j].y + (dy >= 0 ? minDist : -minDist);
          } else if (d <= 0.001) {
            sorted[i].y = sorted[j].y + minDist;
          }
        }
      }

      ptsPx.forEach((entry, idx) => {
        const pt = entry.pt;
        const marker = document.createElement("div");
        const kubun = String(pt.KUBUN || "");
        let cls = "point-marker";
        if (kubun === "1") cls += " kubun-link";
        else if (kubun === "3" || kubun === "4") cls += " kubun-label";
        marker.className = cls;

        marker.style.left = `${(entry.x / natW) * 100}%`;
        marker.style.top = `${(entry.y / natH) * 100}%`;
        marker.textContent = kubun === "1" ? "→" : String(idx + 1);
        marker.title = pointTitle(kubun, pt.DATA);
        // 原版にない WebUI 独自の補完: hover で部品名を即時表示 (title は
        // ネイティブ tooltip のためパン/ズーム中は邪魔にならない)
        marker.addEventListener("mouseenter", () => {
          if (marker.dataset.titleResolved) return;
          marker.dataset.titleResolved = "1";
          resolvePointTitle(syasyu, kubun, pt.DATA).then((t) => {
            if (t) marker.title = t;
          });
        });

        // Click handler for ALL kubuns
        marker.addEventListener("click", () => {
          if (kubun === "1" && pt.DATA) {
            // Link to another figure
            loadDiagram(syasyu, pt.DATA);
          } else {
            // Fill the bottom input bar like the original SEPCW0390 input bar
            const pc = document.getElementById("textPartsCode");
            const pcn = document.getElementById("textPartsCodeName");
            const iq = document.getElementById("inputQty");
            // "*" 以降はイラスト記号 (ILLUST_KIGOU) — 部品コードと分けて保持
            const mKigou = String(pt.DATA || "").match(/^([^*]+)\*([A-Z0-9]+)$/);
            const code = mKigou ? mKigou[1] : String(pt.DATA || "").replace(/\*+$/, "");
            const kigou = mKigou ? mKigou[2] : "";
            if (pc) pc.value = code;
            if (pcn) pcn.value = "";
            // 原版準拠: 部品コード選択時に個数はクリア (未確定扱い)
            if (iq) iq.value = "";
            state.pointParts = { code, kigou, syasyu, figNo, figNum };
            // Fetch point data
            loadPointData(syasyu, figNo, figNum, kigou ? `${code}~${kigou}` : code, kubun, idx + 1);
          }
        });

        wrap.appendChild(marker);
      });
      setupDiagramPanZoom();
    });

    img.addEventListener("error", () => {
      display.innerHTML = '<div class="card"><p style="color:var(--error,var(--error,var(--primary)))">図面が見つかりません</p></div>';
    });
  } catch (e) {
    display.innerHTML = `<div class="card"><p style="color:var(--error,var(--error,var(--primary)))">エラー: ${esc(e.message)}</p></div>`;
  }
}

// ホットスポット hover title — 部品名を同期的に引けるものは即座に、
// そうでなければ kubun 別の短いヒント (詳細は click で point-data が充填される)
function pointTitle(kubun, data) {
  const d = String(data || "");
  if (kubun === "1") return "→ 別図へリンク";
  const pn = window._staticPointNames;
  if (pn) {
    if (kubun === "4") {
      const code = (pn.codeOfNumber || {})[d];
      const name = code ? (pn.partsNames || {})[code] : "";
      if (name) return `${d} ${name}`;
    } else if (kubun === "3" || kubun === "2") {
      const name = (pn.partsNames || {})[d.replace(/\*+$/, "").split("*")[0]];
      if (name) return name;
    }
  }
  return kubun === "4" ? d : "ホットスポット";
}

// title が未解決 (部品名引きが必要) な点の遅延解決 — illust/point-data は
// 図面単位で pointNames を引くので marker hover 時に 1 回だけ叩く
async function resolvePointTitle(syasyu, kubun, data) {
  try {
    // kubun=3 の "コード*記号" 形は記号を剥がして名前を引く
    const d = kubun === "3" ? String(data || "").replace(/\*+$/, "").split("*")[0] : data;
    const pd = await api("illust/point-data", {
      syasyu, fig_no: state.selectedFig ? state.selectedFig.figNo : "",
      fig_num: state.selectedFig ? state.selectedFig.figNum : "01",
      data: d, kubun: parseInt(kubun),
    });
    return pd.length ? String(pd[0].NAME || "") : "";
  } catch (e) { return ""; }
}

async function loadPointData(syasyu, figNo, figNum, data, kubun, pointIdx) {
  const infoEl = document.getElementById("diag-point-info");
  if (!infoEl) return;
  infoEl.innerHTML = `<div class="card"><div class="loading"></div> ポイント${pointIdx}のデータを取得中…</div>`;
  try {
    const pd = await api("illust/point-data", {
      syasyu, fig_no: figNo, fig_num: figNum, data, kubun: parseInt(kubun),
    });

    // 見出しは部品名主体に (KUBUN/DATA は図中に記載されているので表示しない)
    const pdName = pd.length ? String(pd[0].NAME || "") : "データなし";
    let html = `<div class="card"><h6 class="large-text">${esc(pdName)}</h6>`;

    // Reflect the parts-code name in the bottom input bar (original IllustDialog behavior)
    const pcn = document.getElementById("textPartsCodeName");
    if (pcn && pd.length) pcn.value = String(pd[0].NAME || "");
    // Remember point data for 「リストに追加」 (hotspot → parts list)
    if (state.pointParts) {
      state.pointParts.name = pd.length ? String(pd[0].NAME || "") : "";
    }

    if (pd.length) {
      // 見出しと同一ならテーブルは省略 (名称が全行同じケースが大半)
      const unique = [...new Set(pd.map((r) => String(r.NAME || "")))];
      if (unique.length > 1 || unique[0] !== pdName) {
        html += `<table><thead><tr><th>名称</th></tr></thead><tbody>`;
        pd.forEach((r) => {
          html += `<tr><td>${esc(r.NAME || "")}</td></tr>`;
        });
        html += `</tbody></table>`;
      }
    } else {
      html += '<p class="small-text" style="opacity:0.7">データなし</p>';
    }

    // "code~kigou" 形 (ILLUST_KIGOU 付きポイント): コードと記号を分ける
    const mK = String(data || "").match(/^([^~]+)~([A-Z0-9]+)$/);
    const codeOnly = mK ? mK[1] : data;
    const kigou = mK ? mK[2] : undefined;

    // For KUBUN=3 (parts code), fetch actual parts numbers via catalog
    if ((kubun === "3" || kubun === "4") && data) {
      html += `<div id="point-catalog"></div>`;
    }
    html += `</div>`;
    infoEl.innerHTML = html;

    // Fetch parts catalog for this parts code
    if ((kubun === "3" || kubun === "4") && data) {
      const catEl = document.getElementById("point-catalog");
      try {
        const parts = await api("parts/catalog", {
          syasyu, parts_code: codeOnly, fig_no: figNo, fig_num: figNum,
          illust_kigou: kigou,
          // VINコンテキストがあれば原版 PartsLogic 同様に絞込 (nenkai/色/VIN採用・廃止年月)
          ...(() => {
            const ctx = getVinContext();
            return (ctx && ctx.vinBefore && ctx.syasyu && ctx.syasyu === syasyu) ? {
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
        });
        if (parts.length) {
          state.diagramParts = parts;
          // 原版準拠: 候補0件はそのまま、1件は自動確定、複数は候補から選択
          catEl.innerHTML = `
            <h6>該当部品 (${parts.length}件)</h6>
            <table>
              <thead><tr><th>No</th><th>部品番号</th><th>部品名</th><th>数量</th><th>適用</th><th></th></tr></thead>
              <tbody>
                ${parts.map((p, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td class="clickable" onclick="goExchange('${esc(p.PARTS_NUMBER)}','${esc(syasyu)}')">${esc(p.PARTS_NUMBER)}</td>
                    <td>${esc(p.PARTS_NAME || "")}</td>
                    <td>${esc(p.QUANTITY || "")}</td>
                    <td class="small-text">${esc(p.TEKIYOU || p.HYOUGEN1 || "")}</td>
                    <td><button class="small-tonal" onclick="addEstimate('${esc(p.PARTS_NUMBER)}','${esc(p.PARTS_NAME || "")}','${esc(p.QUANTITY || 1)}','','${esc(syasyu)}','${esc(figNo)}')">追加</button></td>
                  </tr>`).join("")}
              </tbody>
            </table>`;
        } else {
          // kubun=4 (部品番号直 points) はコード未登録のこともある — 番号自体は有効なので品番引くに渡す
          if (kubun === "4" && /^[0-9A-Z]{6,}$/.test(codeOnly)) {
            catEl.innerHTML = `
              <p style="margin-top:8px;">このポイントは部品番号 <b>${esc(codeOnly)}</b> を指しています (名称・適合はこの車種のDBに未収録)。</p>
              <button class="border small" onclick="goExchange('${esc(codeOnly)}','${esc(syasyu)}')">互換を調べる</button>`;
          } else {
            catEl.innerHTML = `<p style="margin-top:8px;color:var(--outline)">${esc(missReason(codeOnly, figNo))}</p>`;
          }
        }
      } catch (e2) {
        catEl.innerHTML = `<p style="margin-top:8px;color:var(--outline)">部品カタログ取得失敗: ${esc(e2.message)}</p>`;
      }
    }
  } catch (e) {
    infoEl.innerHTML = `<div class="card"><p style="color:var(--error,var(--primary))">エラー: ${esc(e.message)}</p></div>`;
  }
}

// 該当部品なしの理由を chunk 行から推定して人間語で返す
// (S401専用マットのような「グレード専用部品」を区別する — IE原版では図中注意文で示される)
function missReason(code, figNo) {
  const ctx = getVinContext() || {};
  try {
    const chunk = window._missChunk;
    const rows = (chunk && chunk.parts && chunk.parts[String(code)]) || null;
    if (!rows || !rows.length) return "該当部品なし (この車種のカタログにこのコードの行がありません)";
    const seisan = ctx.vinBefore ? seisanYmdForFig(figNo || ctx._figNo || (state.selectedFig && state.selectedFig.figNo), ctx) : "";
    if (seisan) {
      const inDate = rows.some((r) =>
        String(r.SAIYOU_YMD || "") <= seisan && String(r.HAISHI_YMD || "99999999") >= seisan);
      if (!inDate) return "該当部品なし (この部品の採用期間はこの車両の生産年月日と重なりません — 前後年式の部品の可能性)";
    }
    const pos = ctx.modelPosition ? parseInt(ctx.modelPosition, 10) : null;
    if (pos) {
      const grade = rows.some((r) => checkAppliedModel(r.APPLIED_MODEL, pos));
      if (!grade) return "該当部品なし (この部品は特定グレード専用 — 図中の注意文を確認してください)";
    }
    // 採用期間・グレードは合うが絞込で落ちる → 数量/オプション等の違い
    return "該当部品なし (この車両の条件 (TRIM・オプション・仕向け) に適合する番号がありません)";
  } catch (e) { /* fallthrough */ }
  return "該当部品なし (車両条件に適合する番号がありません)";
}

