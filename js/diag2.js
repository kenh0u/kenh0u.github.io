// ---------------------------------------------------------------------------
// Diagram toolbar / zoom / tokki (SEPCW0390 menubar & toolbar mirror)
// ---------------------------------------------------------------------------
state.zoom = 1;

function currentListIndex(listSel) {
  const items = document.querySelectorAll(listSel + " .item");
  let idx = -1;
  items.forEach((it, i) => { if (it.classList.contains("selected")) idx = i; });
  return { items, idx };
}

function clickItem(items, idx) {
  if (items && idx >= 0 && idx < items.length) items[idx].click();
}

document.addEventListener("click", (e) => {
  const id = e.target.closest("button")?.id;
  if (id === "dt-prev-fig") {
    const { items, idx } = currentListIndex("#fig-list");
    clickItem(items, idx <= 0 ? items.length - 1 : idx - 1);
  } else if (id === "dt-next-fig") {
    const { items, idx } = currentListIndex("#fig-list");
    clickItem(items, idx === items.length - 1 ? 0 : idx + 1);
  } else if (id === "dt-prev-d") {
    const { items, idx } = currentListIndex("#fig-group-list");
    clickItem(items, idx <= 0 ? items.length - 1 : idx - 1);
  } else if (id === "dt-next-d") {
    const { items, idx } = currentListIndex("#fig-group-list");
    clickItem(items, idx === items.length - 1 ? 0 : idx + 1);
  } else if (id === "dt-prev-num" || id === "dt-next-num") {
    // FIG_NUM (枚) 切替 — 世代/グレード別の枝図 (590-01=前期 等)。五感情報枚はスキップ。
    const sf = state.selectedFig;
    const all = (state.figNumList || []);
    const cands = all.map((f) => f.num);
    const isInfo = (n) => {
      const f = all.find((x) => x.num === n);
      return f && f.note && f.note.includes("ｺﾞｶﾝｼﾞﾖｳﾎｳ");
    };
    if (!sf || !cands.length) return;
    let i = cands.indexOf(sf.figNum);
    for (let step = 0; step < cands.length; step++) {
      i = id === "dt-prev-num"
        ? (i <= 0 ? cands.length - 1 : i - 1)
        : (i === cands.length - 1 ? 0 : i + 1);
      if (!isInfo(cands[i])) break;
    }
    loadDiagram(sf.syasyu || state.selectedModel, sf.figNo, cands[i]);
  } else if (id === "dt-buhin") {
    resolveEstimate();
  }
});

// ホットスポット→バスケットへの登録は addEstimate が行う。
// diag-basket クリアは見積と共通バスケットの一元化。

// 拡大 / 縮小 / 全体 (ズーム) + パン
// state.zoom is relative to the natural image size; state.zoomFit = width:100% mode
// デフォルトは画面幅合わせ (zoomFit) — 虫眼鏡 (+/-) を押すと解除される。
function applyZoom() {
  const img = document.getElementById("diag-img");
  if (!img) return;
  if (state.zoomFit) {
    img.style.width = "100%";
  } else {
    const natW = (state.diagramNat && state.diagramNat.natW) || img.naturalWidth;
    const z = Math.min(8, Math.max(0.2, state.zoom || 1));
    img.style.width = `${natW * z}px`;
  }
}

function diagramZoomBy(factor) {
  const img = document.getElementById("diag-img");
  if (!img) return;
  const natW = (state.diagramNat && state.diagramNat.natW) || img.naturalWidth || 1;
  const fitZoom = img.offsetWidth && img.naturalWidth ? img.offsetWidth / natW : 1;
  const base = state.zoomFit ? fitZoom : (state.zoom || 1);
  state.zoom = Math.min(8, Math.max(0.2, base * factor));
  state.zoomFit = false;
  applyZoom();
}

// Pan (mouse drag) のみ — ホイール/ピンチは拡縮に使わない (図上スクロールはスクロール)
function setupDiagramPanZoom() {
  const container = document.getElementById("diag-container");
  if (!container) return;

  // Mouse drag pan
  let dragging = false, startX = 0, startY = 0, sl = 0, st = 0;
  container.addEventListener("mousedown", (e) => {
    if (e.target.closest(".point-marker")) return;
    dragging = true;
    startX = e.pageX; startY = e.pageY;
    sl = container.scrollLeft; st = container.scrollTop;
    container.classList.add("panning");
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    container.scrollLeft = sl - (e.pageX - startX);
    container.scrollTop = st - (e.pageY - startY);
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    container.classList.remove("panning");
  });
}

// Delegated: toolbar buttons exist per-figure (rendered into diagram-display)
document.addEventListener("click", (e) => {
  const id = e.target.closest("button")?.id;
  if (id === "dz-in") return diagramZoomBy(1.25);
  if (id === "dz-out") return diagramZoomBy(1 / 1.25);
  if (id === "dz-fit") { state.zoomFit = true; state.zoom = 1; applyZoom(); return; }
  if (id === "dz-tokki") {
    const el = document.getElementById("diag-tokki");
    if (!el) { toast("この図面には特記がありません"); return; }
    el.style.display = el.style.display === "none" ? "" : "none";
  }
  if (id === "point-add-btn") {
    // 個数を付けずに追加 (数量1) — hotspot選択中の部品
    const pp = state.pointParts;
    if (!pp || !pp.code) { toast("図面のホットスポットを選択してください"); return; }
    const name = (document.getElementById("textPartsCodeName") || {}).value || pp.name || "";
    const qty = parseInt((document.getElementById("inputQty") || {}).value, 10) || 1;
    addEstimate(pp.code, name, qty, "", pp.syasyu || "", pp.figNo || "");
  }
});

// ホットスポット→部品リスト (原版 SEPCW0390 流儀):
// 左クリック(選択) → 個数を入れて change で確定 → 見積バスケットへ。
// 個数 0 / 空白 = 未確定に戻す (ModelessExplodedViewController.onQtyChanged 準拠)。
function onQtyChanged(qtyRaw) {
  const pp = state.pointParts;
  const qty = parseInt(qtyRaw, 10);
  if (!pp || !pp.code || (!Number.isInteger(qty) && String(qtyRaw).trim() !== "")) return;
  if (!Number.isInteger(qty) || qty <= 0) {
    // 未確定に戻す (数量消込)
    state.pointParts = null;
    const pc = document.getElementById("textPartsCode");
    const pcn = document.getElementById("textPartsCodeName");
    if (pc) pc.value = "";
    if (pcn) pcn.value = "";
    const q = document.getElementById("inputQty");
    if (q) q.value = "";
    return;
  }
  const name = document.getElementById("textPartsCodeName");
  addEstimate(pp.code, (name && name.value) || pp.name || "", qty, "", pp.syasyu || "", pp.figNo || "");
}

// 個数 change → 確定 (原版 onQtyChanged)
document.addEventListener("change", (e) => {
  if (!(e.target && e.target.id === "inputQty")) return;
  onQtyChanged(e.target.value);
});
// Enter でも確定 (原版 keypress 準拠)
document.addEventListener("keypress", (e) => {
  if (!(e.target && e.target.id === "inputQty")) return;
  if (e.key === "Enter") onQtyChanged(e.target.value);
});

