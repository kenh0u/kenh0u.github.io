// ---------------------------------------------------------------------------
// Static mode — fetch pre-built JSON chunks from the static CDN. This build
// is STATIC-ONLY (no /api fallback): every handler must resolve from chunks.
//
// Transport rules:
//  - static files ship precompressed as path + ".gz" (gzip -9)
//  - config: window.STATIC_BASE (root of the static distribution)
// ---------------------------------------------------------------------------
"use strict";

const STATIC_BASE = (window.STATIC_BASE != null ? window.STATIC_BASE : "/catalog-static/").replace(/[^/]*$/, "");
// Static-only distribution: static chunks are the sole data path. The
// epc-static-force override remains as an escape hatch for development.
let staticUIAvailable = true;
if (localStorage.getItem("epc-static-force") === "0") staticUIAvailable = false;

async function fetchStatic(path) {
  // chunks ship as path + ".gz" (gzip -9): precompressed, no server runtime.
  // {cache: "reload"} — python -m http.server は Last-Modified ベースの HTTP cache
  // を持つため、配布差し替え後に古い manifest が残るのを防ぐ。
  const res = await fetch(STATIC_BASE + path + ".gz", { cache: "reload" });
  if (!res.ok) throw new Error(`static ${res.status} for ${path}`);
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([await res.arrayBuffer()]).stream().pipeThrough(ds);
  return JSON.parse(await new Response(stream).text());
}

// Cache: manifest/pointNames etc per-catalog
const staticCache = new Map();

async function getCatalogManifest(syasyu) {
  const key = `manifest:${syasyu}`;
  if (!staticCache.has(key)) {
    staticCache.set(key, fetchStatic(`catalog/${syasyu}/manifest.json`).catch((e) => {
      staticCache.delete(key);
      throw e;
    }));
  }
  return staticCache.get(key);
}

// ---------------------------------------------------------------------------
// Port of parts_filter.py — narrowing pipeline on raw fig-chunk candidates
// ---------------------------------------------------------------------------

function isNull(v) { return v == null || v === ""; }

const APPLIED_MODEL_TABLE = {
  0: ["1", "3", "5", "7", "9", "B", "D", "F"],
  1: ["8", "9", "A", "B", "C", "D", "E", "F"],
  2: ["4", "5", "6", "7", "C", "D", "E", "F"],
  3: ["2", "3", "6", "7", "A", "B", "E", "F"],
};

function getAppliedModels(position) {
  if (position == null || position === "") return null;
  const pos = parseInt(position, 10);
  let index = Math.floor(pos / 4);
  const mod = pos % 4;
  if (mod === 0) index -= 1;
  return { index: index + 1, applied: APPLIED_MODEL_TABLE[mod] };
}

function checkAppliedModel(appliedModel, position) {
  const info = getAppliedModels(position);
  if (!info) return false;
  if (!appliedModel) return true;
  const target = (appliedModel[info.index - 1] || "").toUpperCase();
  return info.applied.indexOf(target) !== -1;
}

function checkOptionPosition(optionPosition, position) {
  if (position == null || optionPosition == null) return false;
  const pos = parseInt(position, 10);
  let idx = Math.floor(pos / 4);
  let mod = pos % 4;
  if (mod === 0) idx -= 1;
  mod -= 1;
  if (mod < 0) mod = 3;
  if (idx > optionPosition.length - 1) return false;
  const nibble = parseInt(optionPosition.slice(idx, idx + 1), 16);
  const bin = (nibble >>> 0).toString(2).padStart(4, "0");
  return bin.slice(mod, mod + 1) === "1";
}

const PARTS_STR_FIELDS = ["PARTS_NUMBER","JOKEN","EXCHANGE_PARTS_NUMBER","ILLUST_KIGOU",
  "NENKAI","SAIYOU_YMD","HAISHI_YMD","KOYU_SHOGEN","KOSHOKU_SHOGEN","DESTINATION",
  "FIG_NO","QUANTITY","KATASHIKI","TEKIYOU","HYOUGEN1","HYOUGEN2","HYOUGEN3",
  "HYOUGEN4","HYOUGEN5"];

function createPartsStr(row) {
  return PARTS_STR_FIELDS.map((f) => String(row[f] || "")).join("_");
}

// SyaryoLogic.getRequiredDate — production date rule by FIG-NO group
function seisanYmdForFig(figNo, ctx) {
  const fig = parseInt(figNo, 10);
  const isBody = ["005","039","055","070","072","073","089","093","096","149","184"].includes(figNo)
    || (!isNaN(fig) && fig >= 0 && fig <= 99);
  const isMission = ["190","195"].includes(figNo) || (!isNaN(fig) && fig >= 100 && fig <= 188);
  if (isNaN(fig)) return ctx.bd || "";
  if (isBody) return ctx.bd || "";
  if (isMission) return ctx.tm || "";
  return ctx.eg || "";  // engine / other
}

function staticNarrowRows(rows, ctx) {
  const syaryo = {
    subaruFlg: "1",
    kokunaiFlg: "1",
    modelPositions: (ctx.modelPosition ? [parseInt(ctx.modelPosition, 10)] : []),
    trimCd: ctx.trimCd || "",
    destination: ctx.destination || "",
    vinBefore: ctx.vinBefore || "",
    vinAfter: ctx.vinAfter || "",
    oemSyasyuCd: ctx.oemSyasyuCd || "",
    model: (ctx.model || "").trim(),
    colorCd: (ctx.colorCode || "").trim(),
    optionCode: ctx.optionCode || "",
    shiyoPatternNo: ctx.shiyoPatternNo || "",
  };
  const nenkaiYmd = (window._staticPointNames && window._staticPointNames.nenkaiYmd) || {};

  // Production date (SyaryoLogic.getRequiredDate; caller passes figNo in ctx._figNo)
  const seisan = ctx.vinBefore ? seisanYmdForFig(ctx._figNo, ctx) : "";
  const saiyouYmd = (seisan || "00000000").slice(0, 6) + "00";
  const haishiYmd = (seisan || "99999999");
  // 年改: MODEL 4桁目 (原版 PartsLogic._createSearchPartsCatalogParameter)
  const nenkaiLetter = seisan && syaryo.model.length >= 4 ? syaryo.model[3] : "";
  const gaiColor = ctx.subaruVin ? (syaryo.colorCd ? syaryo.colorCd.slice(1) : "") : "";

  // Step 1: drop all-zeros APPLIED_MODEL rows
  const filtered = rows.filter((r) => !/^[0]+$/.test(String(r.APPLIED_MODEL || "0")));

  // Step 2: SQL-side equivalent pre-filters (date/nenkai/色) mirroring
  // select_parts_number WHERE — keeps candidates comparable to API answers
  const pre = filtered.filter((r) => {
    const sai = String(r.SAIYOU_YMD || "00000000");
    const hai = String(r.HAISHI_YMD || "99999999");
    if (ctx.vinBefore) {
      if (!(sai <= haishiYmd && hai >= saiyouYmd)) return false; // 'YYYYMMDD' strings compare lexically
    }
    if (gaiColor) {
      const cc = r.COLOR_CODE || "";
      if (cc && !cc.includes(gaiColor)) return false;
    }
    if (nenkaiLetter) {
      // nenkaiYmd は VIEW_NENKAI キー (model[3] は画面表示の年改 = VIEW_NENKAI)。
      // 内部 NENKAI が VIEW と異なる車種 (A10 等 10車種) があるため view→internal 変換。
      const ny = nenkaiYmd[nenkaiLetter] || null;
      if (!ny) return false;
      const internal = (typeof ny === "object" && !Array.isArray(ny)) ? ny.internal : nenkaiLetter;
      const nyRange = (typeof ny === "object" && !Array.isArray(ny)) ? ny.range : ny;
      if (r.NENKAI !== internal) return false;
      if (nyRange && !(sai <= nyRange[1] && hai >= nyRange[0])) {/* match orig: nenkai_clause catches OR ... */}
    }
    return true;
  });

  // Group by parts_code
  const groups = {};
  pre.forEach((r) => {
    const code = String(r.PARTS_CODE || "");
    (groups[code] = groups[code] || []).push(r);
  });

  let out = [];
  Object.values(groups).forEach((items) => {
    let res = items;
    // narrow_by_applied_model
    if (syaryo.modelPositions.length) {
      res = res.filter((r) =>
        syaryo.modelPositions.some((pos) => checkAppliedModel(r.APPLIED_MODEL, pos)));
    }
    // narrowing_by_trim_code (SUBARU path)
    if (!isNull(syaryo.trimCd)) {
      const syaryoTrim = syaryo.trimCd.length > 2 ? syaryo.trimCd.slice(1, 2) : "";
      res = res.filter((r) => {
        const intColor = r.INT_COLOR != null ? r.INT_COLOR : r.TRIM_CODE;
        if (isNull(intColor)) return true;
        return intColor.split(",").some((t) => (t || "").slice(1, 2) === syaryoTrim);
      });
    }
    // narrowing_by_destination_code — kokunai pass-through (static build is 国內 only)
    // narrowing_by_fig_num (dedup)
    const seen = new Set();
    res = res.filter((r) => {
      const k = createPartsStr(r);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    // narrowing_by_kirikae_code — mostly no-op when no OemSyasyuCd; skipping
    // narrowing_by_option_code — OPTION_INDEX は SELECT時の M_OPTION_CODE join が
    // 源なので chunk 行には無い。代わりに pointNames.optionCodes[optionCode] で引く。
    if (syaryo.optionCode) {
      const oc = (window._staticPointNames && window._staticPointNames.optionCodes) || {};
      // M_OPTION_CODE のキーは空白pad ('  C') のままのケースがある — trim→raw→pad の順で照合
      const opt = syaryo.optionCode;
      const optionIndex = oc[opt] ?? oc[`  ${opt}`] ?? oc[` ${opt}`] ?? null;
      const op = res.filter((r) =>
        isNull(r.OP_FLG) &&
        r.OPTION_POSITION != null && optionIndex != null &&
        checkOptionPosition(r.OPTION_POSITION, optionIndex));
      if (!op.length) {
        res = res.filter((r) => !isNull(r.OP_FLG) && String(r.OP_FLG).includes("*"));
      } else res = op;
    }
    out = out.concat(res);
  });
  return out;
}

function staticFormatRow(raw) {
  const pn = window._staticPointNames || {};
  return {
    PARTS_NUMBER: raw.PARTS_NUMBER,
    PARTS_NAME: pn.partsNames ? (pn.partsNames[raw.PARTS_CODE] || "") : "",
    QUANTITY: raw.QUANTITY || "",
    TEKIYOU: raw.TEKIYOU || "",
    ILLUST_KIGOU: raw.ILLUST_KIGOU || "",
    FIG_NO: raw.FIG_NO,
    FIG_NUM: raw.FIG_NUM,
    SAIYOU_YMD: raw.SAIYOU_YMD,
    HAISHI_YMD: raw.HAISHI_YMD === "999999" ? "" : raw.HAISHI_YMD,
    NENKAI: raw.NENKAI,
    APPLIED_MODEL: raw.APPLIED_MODEL,
    KIRIKAE_FROM: raw.KIRIKAE_FROM,
    KIRIKAE_TO: raw.KIRIKAE_TO,
    BUHIN_TANKA: (pn.prices && pn.prices[raw.PARTS_NUMBER]) || 0,
    price: (pn.prices && pn.prices[raw.PARTS_NUMBER]) || 0,
    EXCHANGE_PARTS_NUMBER: raw.EXCHANGE_PARTS_NUMBER || "",
    JOKEN: raw.JOKEN || "",
    KATASHIKI: raw.KATASHIKI || "",
    PARTS_CODE: raw.PARTS_CODE,
  };
}

// Sort helper (api equivalent: sort_by_shimuke_usa_last)
function staticSortRows(rows) {
  return rows.sort((a, b) => String(a.PARTS_NUMBER).localeCompare(String(b.PARTS_NUMBER)));
}

// katashiki/model rows: kigou list (empty-dropped at build) → KIGOU_1..23 as-is
function kigouCols(list) {
  const out = {};
  for (let i = 0; i < 23; i++) out[`KIGOU_${i + 1}`] = list[i] || "";
  return out;
}

// ---------------------------------------------------------------------------
// The /api replacement — thin dispatch by path
// ---------------------------------------------------------------------------

async function staticApi(path, params) {
  // ---- fig-listing / point / catalog workhorse endpoints --------------
  if (path === "parts/catalog") {
    // needs: syasyu, parts_code, fig_no (省略可), fig_num + vin ctx.
    // fig_no 未指定: figsByCode の最初の FIG で代用する (元API同等の挙動は
    // 全FIG横断だが静的第一版は代表FIGのみ — figsByCode で補完可能)。
    const syasyu = params.syasyu;
    let figNo = params.fig_no;
    if (!figNo) {
      const m = await getCatalogManifest(syasyu);
      figNo = (m.figsByCode[String(params.parts_code)] || [])[0];
      if (!figNo) return [];
    }
    const [chunk, m] = await Promise.all([
      fetchStatic(`catalog/${syasyu}/fig-${figNo}.json`),
      getCatalogManifest(syasyu),
    ]);
    // 該当なし理由判定用に chunk を覚えておく (missReason が参照)
    window._missChunk = chunk;
    window._staticPointNames = m.pointNames;  // 年改 (nenkaiYmd) 等 narrowing に必須
    let rows = chunk.parts[String(params.parts_code)] || [];
    // ILLUST_KIGOU 指定 (point.data の "コード*記号" 形): 記号で行を絞る
    // (原版 select_parts_number illust_kigou_clause 相当)
    if (params.illust_kigou) {
      rows = rows.filter((r) => String(r.ILLUST_KIGOU || "") === String(params.illust_kigou));
    }
    const ctx = getVinContext() || {};
    if (!(ctx.vinBefore && ctx.syasyu === syasyu)) {
      // manual model select = no narrowing (原版流儀)
      return staticSortRows(rows.map(staticFormatRow));
    }
    ctx._figNo = figNo;
    const narrowed = staticNarrowRows(rows, ctx);
    return staticSortRows(narrowed.map(staticFormatRow));
  }

  if (path === "illust/points") {
    const chunk = await fetchStatic(
      `catalog/${params.syasyu}/fig-${params.fig_no}.json`);
    const fn = params.fig_num || "01";
    return chunk.points
      .filter((p) => (p.figNum || "01") === fn)
      .map((p) => ({
        KUBUN: p.kubun, DATA: p.data, START_X: p.x2, START_Y: p.y2,
        END_X: p.x, END_Y: p.y,
      }));
  }

  if (path === "illust/exploded-view") {
    const chunk = await fetchStatic(
      `catalog/${params.syasyu}/fig-${params.fig_no}.json`);
    const hdr = (chunk.headers || {})[params.fig_num || "01"] || chunk.header || {};
    return [{
      FIG_NO: params.fig_no, FIG_NUM: params.fig_num || "01",
      FIG_NAME: chunk.header.figName, TEKIYO_SHASHU: hdr.tekiyoShashu || "",
      SAIHAI_YM: hdr.saihai || "", ILLUST_NOTE: hdr.illustNote || "",
    }];
  }

  if (path === "illust/memo") {
    const chunk = await fetchStatic(
      `catalog/${params.syasyu}/fig-${params.fig_no}.json`);
    return (chunk.header.memo || []).map((t) => ({ FIG_NO: params.fig_no, TOKKI: t }));
  }

  if (path === "illust/point-data") {
    const pn = (await getCatalogManifest(params.syasyu)).pointNames;
    window._staticPointNames = pn;
    const data = String(params.data || "");
    const kubun = parseInt(params.kubun, 10);
    if (kubun === 1) {
      // DATA=FIG_NO → fig name
      const name = (pn.figNames && pn.figNames[data]) || "";
      return name ? [{ KUBUN: 1, NAME: name }] : [];
    }
    if (kubun === 4) {
      const code = pn.codeOfNumber[data];
      return code && pn.partsNames[code]
        ? [{ KUBUN: 4, NAME: pn.partsNames[code], DATA: code }] : [];
    }
    return pn.partsNames[data] ? [{ KUBUN: kubun, NAME: pn.partsNames[data] }] : [];
  }

  if (path === "zentaizu") {
    const m = await getCatalogManifest(params.syasyu);
    return { regions: m.regions.map((r) => ({
      FIG_GROUP: r.figGroup, FIG_GROUP_NAME: r.name || "",
      START_X: r.start[0], START_Y: r.start[1], END_X: r.end[0], END_Y: r.end[1],
    })) };
  }

  if (path === "fig-group") {
    const m = await getCatalogManifest(params.syasyu);
    return (m.figs[params.fig_group] || []).map((f) => ({
      FIG_NO: f.figNo, FIG_NAME: f.name,
    }));
  }

  if (path === "nenkai") {
    const m = await getCatalogManifest(params.syasyu);
    return m.nenkai.map((n) => ({
      NENKAI: n.view, VIEW_NENKAI: n.view, SAIYO_YMD: n.saiyo, HAISHI_YMD: n.haishi,
    }));
  }

  if (path === "shashu") {
    const idx = await fetchStatic("index.json");
    return idx.models.map((m) => ({
      CODE: m.code, NAME: m.name, SAIYO_YM: m.saiyo,
      HAISHI_YM: m.haishi === "999999" ? "" : m.haishi, DAIHYO: m.daihyo,
    }));
  }
  if (path === "vehicle/search") {
    const prefix = String(params.vin_before || "").toUpperCase();
    const after = String(params.vin_after || "").toUpperCase();
    const vpIdx = await fetchStatic(`vin/${prefix}/index.json`);
    const part = Object.keys(vpIdx.partitions).find(
      (p) => after >= vpIdx.partitions[p].min && after <= vpIdx.partitions[p].max);
    if (!part) return [];
    const chunk = await fetchStatic(`vin/${prefix}/${part}.json`);
    const oem = params.vin_after_oem || "";
    return chunk.vins.filter((v) => {
      if (v.VIN_AFTER !== after) return false;
      if (oem && (v.OEM_SYASYU_CD || "") !== oem) return false;
      return true;
    }).map((v) => ({
      VIN_BEFORE: v.VIN_BEFORE, VIN_AFTER: v.VIN_AFTER, SHASHUCTLG: v.SHASHUCTLG,
      SYASYU_CD: v.SHASHUCTLG, OEM_SYASYU_CD: v.OEM_SYASYU_CD, MODEL: v.MODEL,
      KATASHIKI_RUIBETSU: v.KATASHIKI_RUIBETSU, COLOR_CD: v.COLOR_CD,
      COLOR_NM: v.COLOR_NM || "", TRIM_CD: v.TRIM_CD, TRIM_NM: v.TRIM_NM || "",
      OPTION_CD: v.OPTION_CD, SHIYO_PATTERN_NO: v.SHIYO_PATTERN_NO,
      MODEL_POSITION: v.MODEL_POSITION, BD_SEISAN_YMD: v.BD_SEISAN_YMD,
      EG_SEISAN_YMD: v.EG_SEISAN_YMD, TM_SEISAN_YMD: v.TM_SEISAN_YMD,
      DESTINATION: v.DESTINATION, SUBARU_FLG: "1", VIEW_NENKAI: v.VIEW_NENKAI || "",
    }));
  }

  if (path === "kirikae") {
    // kirikae.json is global-ish: prefix keyed at root
    const data = await fetchStatic("kirikae.json");
    const vb = String(params.vin_before || "").toUpperCase();
    const va = String(params.vin_after || "").toUpperCase();
    const vaInt = parseInt(va, 10);
    const rows = (data[vb] || []).filter(
      (r) => parseInt(r.start, 10) <= vaInt && parseInt(r.end, 10) >= vaInt);
    return rows.map((r) => ({ KIRIKAE_CD: r.cd, FIG_GROUP: "", FIG_NO: "" }));
  }

  if (path === "maintenance") {
    const m = await getCatalogManifest(params.syasyu);
    const t = await fetchStatic(`catalog/${params.syasyu}/tenken.json`);
    // tenken rows carry code+name directly
    return t.rows.map((r) => ({
      PARTS_CODE: r.code, PARTS_NAME: r.name || "",
      QUANTITY: "", PARTS_NUMBER: "",
    }));
  }

  if (path === "emokuji") {
    const t = await fetchStatic(`catalog/${params.syasyu}/emokuji.json`);
    let rows = t.rows;
    const g = params.group;
    if (g && g !== "%") rows = rows.filter((r) => (r.group || "").startsWith(g));
    return rows.map((r) => ({
      FIG_NO: r.figNo, EMOKUJI_GROUP: r.group, EMOKUJI_ORDER: r.order,
      EMOKUJI: r.order, FIG_NAME: r.name, ALIAS: r.alias,
    }));
  }

  if (path === "parts/search") {
    const t = await fetchStatic(`catalog/${params.syasyu}/search.json`);
    const words = params.words || [];  // repeat-param — core's api() serializes words as array items; static receives only last. Handle string | array.
    const wlist = Array.isArray(words) ? words : String(words || "").split(/[,\s]+/).filter(Boolean);
    const hits = Object.entries(t.words).filter(([w]) => wlist.includes(w)).flatMap(([, cs]) => cs);
    const uniq = [...new Set(hits)];
    return uniq.map((code) => ({
      PARTS_CODE: code, PARTS_NAME: t.codeNames[code] || "",
      PARTS_NUMBER: (t.reprNumber || {})[code] || "",
      FIG_NO: "", FIG_NUM: "",
      SAIYOU_YMD: "", HAISHI_YMD: "", TEKIYOU: "",
    }));
  }

  if (path === "parts/codes" || path === "parts/codes-fuzzy") {
    // SELECT_PARTSCODE: code → name, representative fig (M_DAIHYO_FIG when
    // subaru=1), HAS_MULTI (>1 distinct figs)
    const m = await getCatalogManifest(params.syasyu);
    const dia = m.daihyoFig || {};
    const figsBy = m.figsByCode || {};
    const codePrefix = String(params.parts_code_prefix || params.parts_code || "")
      .replace(/%/g, "");
    const names = m.pointNames.partsNames;
    let codes = Object.keys(names).sort();
    if (codePrefix) {
      if (path === "parts/codes-fuzzy") codes = codes.filter((c) => c.includes(codePrefix));
      else codes = codes.filter((c) => c.startsWith(codePrefix));
    }
    return codes.map((c) => ({
      PARTS_CODE: c, PARTS_CODE_NAME: names[c] || "",
      FIG_NO: dia[c] || (figsBy[c] || [])[0] || "",
      HAS_MULTI: (figsBy[c] || []).length > 1 ? "1" : "0",
    }));
  }

  if (path === "parts/figures") {
    const m = await getCatalogManifest(params.syasyu);
    const code = String(params.parts_code || "");
    const names = m.pointNames.partsNames[code] || "";
    return (m.figsByCode[code] || []).map((fn) => ({ FIG_NO: fn, FIG_NAME: names, PARTS_CODE: code }));
  }

  if (path === "parts/fig-count") {
    const m = await getCatalogManifest(params.syasyu);
    const codes = String(params.parts_codes || "").split(",").filter(Boolean);
    return codes.map((c) => ({
      PARTS_CODE: c, FIG_COUNT: (m.figsByCode[c] || []).length,
    }));
  }

  if (path === "fig-group/info") {
    const m = await getCatalogManifest(params.syasyu);
    const gn = (m.groupNames || {})[params.fig_group] || "";
    return [{ FIG_GROUP: params.fig_group, FIG_GROUP_NAME: gn }];
  }

  if (path === "model/list") {
    // GET_MODEL_LIST source: M_SEKKEI_KATASHIKI (not M_MODEL)
    const m = await getCatalogManifest(params.syasyu);
    const spec = m.syaryoSpec;
    let rows = (spec.positions || []).map((r) => {
      const saiyou = r.saiyou || "";
      const haishi = r.haishi || "";
      return {
        SHASHUCTLG: params.syasyu, MODEL_POSITION: r.position,
        SEKKEI_KATASHIKI: r.sekkei || "",
        SAIYOU_YM: saiyou, HAISHI_YM: haishi,
        SAIHAI_YM: haishi === "" || haishi === "999999"
          ? saiyou + " - " : saiyou + " - " + haishi,
        AREA_CD: "D", KOKUNAI_FLG: "1", SUBARU_FLG: "1",
        ...kigouCols(r.kigou || []),
      };
    });
    if (params.positions) {
      const set = new Set(String(params.positions).split(","));
      rows = rows.filter((r) => set.has(String(r.MODEL_POSITION)));
    }
    return rows;
  }

  if (path === "nengetsu-by-nenkai") {
    const m = await getCatalogManifest(params.syasyu);
    const n = m.nenkai.find((x) => x.view === params.nenkai) || {};
    return [{ NENKAI: params.nenkai, SAIYO_YMD: n.saiyo || "", HAISHI_YMD: n.haishi || "" }];
  }

  if (path === "element-list") {
    // GET_ELEMENT_LIST — per kubun: all kigou (with name/order), rows = kubun
    // filtered: each element constraint (kigou=elem AND kubun=i) OR kubun=i-only
    const m = await getCatalogManifest(params.syasyu);
    const spec = m.syaryoSpec;
    const elems = String(params.elements || "").split(",");
    const out = [];
    const kubunKeys = Object.keys(spec.elements || {}).sort((a, b) => a - b);
    kubunKeys.forEach((kn, i) => {
      const elem = elems[i];
      // constraint: kubun must match OR (elem != "" and kigou == elem within this kubun)
      if (elem && !spec.elements[kn].includes(elem)) return;
      spec.elements[kn].forEach((k) => out.push({
        KUBUN_NUMBER: "(" + kn + ")",
        KUBUN_NAME: (spec.kubunNames || {})[kn] || "",
        KIGOU: k, KIGOU_NAME: spec.elemNames[k] || "",
      }));
    });
    return out;
  }

  if (path === "positions") {
    // GET_POSITION_LIST port — NOTE faithful off-by-one of the mapper:
    // elements[i] (i>0) → KIGOU_{i} = pos.kigou[i-1] (0-based array)
    const m = await getCatalogManifest(params.syasyu);
    const spec = m.syaryoSpec;
    const elems = String(params.elements || "").split(",").filter((x) => x !== "");
    let rows = spec.positions || [];
    if (elems.length) {
      rows = rows.filter((r) =>
        elems.every((e, i) => !e || i === 0 || (r.kigou[i - 1] || "") === e));
    }
    return rows.map((r) => ({ MODEL_POSITION: r.position }));
  }

  if (path === "element-exist") {
    // SELECT_EXIST_ELEMENT_LIST — ALL kigou of kubun=element_index with EXIST
    // '0'/'1' (API parity: not only EXIST=1). Elements match via LIKE on
    // KIGOU_{i+1}; at i == element_index-1 the column is compared to itself.
    const m = await getCatalogManifest(params.syasyu);
    const spec = m.syaryoSpec;
    const idx = parseInt(params.element_index, 10);
    const elems = String(params.elements || "").split(",");
    const kubun = String(idx);
    const kubunName = (spec.kubunNames || {})[kubun] || "";
    const kigouList = (spec.elements || {})[kubun] || [];
    return kigouList.map((kigou) => {
      const exist = (spec.positions || []).some((pos) => {
        return elems.every((e, i) => {
          if (i === idx - 1) return true;  // LIKE KIGOU — self comparison
          if (!e) return true;             // LIKE :elem with elem='' matches all
          return (pos.kigou[i] || "").includes(e);
        });
      });
      return { KIGOU: kigou, EXIST: exist ? "1" : "0",
               KIGOU_NAME: spec.elemNames[kigou] || "", KUBUN_NAME: kubunName };
    });
  }

  if (path === "parts/exchange") {
    // path arrives as "parts/exchange/<num>" — normalize: caller passes full
    // path string with number suffix inside params._exNum (tabs4 passes
    // parts/exchange/${partsNum}); the handler needs the number: core.js puts
    // it into params._pathTail.
    const startNum = params._pathTail || "";
    if (!startNum) throw new Error("parts/exchange: missing number");
    const syasyuCode = params.syasyu_code || "";
    const exData = await fetchStatic("exchange.json");
    const jokenMap = { "1":"10770:0","2":"10770:0","3":"10770:0",
      "4":"10780:1","5":"10780:1","6":"10105:1","7":"10105:1","8":"10775:1" };
    const result = [];
    const walk = (num, parents, depth) => {
      if (depth >= 20) return;
      let rows = exData.edges[num] || [];
      // TEKIYOU filter (filter_by_tekiyou)
      if (rows.some((r) => r.t)) {
        const f = rows.filter((r) => r.t && r.t.includes(syasyuCode));
        if (f.length) rows = f;
      }
      rows.forEach((r, i) => {
        const [lid, ref] = (jokenMap[r.j] || "11030:0").split(":");
        const outRow = {
          PARTS_NUMBER: r.n, EXCHANGE_PARTS_NUMBER: r.n, JOKEN: r.j,
          JYOUKEN_LABEL_ID: lid, REFFLG: parseInt(ref, 10),
          PARTS_CODE: r.code, PARTS_CODE_NAME: r.name,
          PARTS_NAME: r.name, USE_QTY: r.q, QTY: 1,
          TEKIYOU: r.t, ZAIKO: r.zo, SOUBETSU_RANK: r.so,
          TANKA: r.ta, KIGOU: r.k, HANBAI_AREA: r.ha,
          TEKIYOU_DATE: r.td, PARTS_PRICE: (exData.prices[r.n]) || 0,
          SHIKIRI_PRICE: 0, SUBARU_FLG: "1", AFTER_SYSDATE: 0,
          DEPTH: depth,
          VIEW_PARTS_NUMBER: i === 0 ? r.n : "",
          HAS_EXCHANGE_PARTS_NUMBER: false,
        };
        result.push(outRow);
        if (r.n && r.n !== num && !parents.includes(r.n)) {
          outRow.HAS_EXCHANGE_PARTS_NUMBER = true;
          walk(r.n, [r.n, ...parents], depth + 1);
        }
      });
    };
    walk(startNum, [startNum], 0);
    return result;
  }

  if (path === "parts/price") {
    // "/parts/price/<num>" — price tool
    const num = params._pathTail || "";
    const m = await getCatalogManifest(params.syasyu || (getVinContext() || {}).syasyu || "T12");
    const price = (m.pointNames.prices || {})[num] || 0;
    return { parts_number: num, price, PARTS_NUMBER: num, PRICE: price };
  }

  if (path === "parts/name") {
    const num = params._pathTail || "";
    const m = await getCatalogManifest(params.syasyu || "T12");
    const code = (m.pointNames.codeOfNumber || {})[num];
    const name = code ? (m.pointNames.partsNames[code] || "") : "";
    if (!name) throw new Error("name not found");
    return { parts_number: num, parts_name: name };
  }

  if (path === "version") {
    return { PRICE_VERSION: "static", DVD_VERSION: "static" };
  }

  // ---- Phase 4 handlers — full offline coverage ------------------------

  if (path.startsWith("shashu/")) {
    const code = path.split("/")[1] || "";
    const idx = await fetchStatic("index.json");
    const m = idx.models.find((x) => x.code === code);
    if (!m) return [];
    return [{ CODE: m.code, NAME: m.name, SAIYO_YM: m.saiyo,
              SAIHAI_YM: m.saiyo + (m.haishi && m.haishi !== "999999"
                ? " - " + m.haishi : " - "),
              HAISHI_YM: m.haishi === "999999" ? "" : m.haishi,
              DAIHYO: m.daihyo, AREA_CD: idx.area_cd,
              KOKUNAI_FLG: "1", SUBARU_FLG: "1" }];
  }

  if (path === "vehicle/katashiki") {
    // 型式入力: DB実在値は SEKKEI_KATASHIKI ("TV1-51R") を前方一致照合のみ。
    // 排ガス記号 (EBD-TV1 等) の変換はしない — "TV1" は対応、"EBD-TV1" は非対応。
    const idx = await fetchStatic("katashiki-by-sekkei.json");
    const raw = String(params.katashiki || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!raw) return [];
    const out = [];
    Object.keys(idx).forEach((sk) => {
      const kk = sk.toUpperCase();
      if (kk.startsWith(raw) || kk.includes(raw)) {
        (idx[sk] || []).forEach((r) => out.push({
          SHASHUCTLG: r.s, SYASYU_CD: r.s, KATASHIKI_RUIBETSU: r.kr || "",
          SEKKEI_KATASHIKI: sk, MODEL_POSITION: r.pos,
          SAIYOU_YM: r.sy, HAISHI_YM: r.hy, SAIHAI_YM: r.sa,
          VIN_BEFORE: "", VIN_AFTER: "", TRIM_CD: "", DESTINATION: "",
        }));
      }
    });
    return out;
  }

  if (path === "vehicle/count") {
    // API parity: SELECT COUNT per SUBARU_FLG (single row, not partition list)
    const prefix = String(params.vin_prefix || "").toUpperCase();
    const idx = await fetchStatic(`vin/${prefix}/index.json`);
    let count = 0;
    Object.values(idx.partitions).forEach((p) => { count += p.rows; });
    return [{ SUBARU_COUNT: count, OEM_COUNT: 0 }];
  }

  if (path === "vehicle/model") {
    const data = await fetchStatic("model.json");
    const key = String(params.model || "").trim();
    return (data[key] || []).map((r) => ({
      SHASHUCTLG: r.s, SYASYU_CD: r.s, MODEL: r.mo, MODEL_POSITION: r.pos,
      SEKKEI_KATASHIKI: r.sk, SAIYOU_YM: r.sy, HAISHI_YM: r.hy,
      SAIHAI_YM: r.sa, VIN_BEFORE: "", VIN_AFTER: "", TRIM_CD: "",
      DESTINATION: "",
      ...kigouCols(r.k),
    }));
  }

  if (path === "illust/list") {
    const t = await fetchStatic(`catalog/${params.syasyu}/narrow-index.json`);
    const saiyou = params.saiyou_ym || "000000";
    const haishi = params.haishi_ym || "999999";
    let rows = t.rows;
    if (params.fig_no) rows = rows.filter((r) => r.figNo === params.fig_no);
    rows = rows.filter((r) => r.saiyou <= haishi && r.haishi >= saiyou);
    return rows.map((r) => ({
      FIG_NO: r.figNo, FIG_NUM: r.figNum, FIG_GROUP: r.figGroup,
      FIG_NAME: r.figName, GOKAN_FLG: r.gokan,
      ILLUST_NOTE: r.note || "", TEKIYO_SHASHU: r.tekiyo || "",
      SAIYOU_YM: r.saiyou, HAISHI_YM: r.haishi,
    }));
  }

  if (path === "fig-group/targets") {
    const m = await getCatalogManifest(params.syasyu);
    const groups = String(params.fig_groups || "").split(",").filter(Boolean);
    const out = [];
    groups.forEach((g) => {
      (m.figs[g] || []).forEach((f) =>
        out.push({ FIG_GROUP: g, FIG_NO: f.figNo, FIG_NAME: f.name }));
    });
    return out;
  }

  if (path === "kigo-ryakugo") {
    const data = await fetchStatic("kigo-ryakugo.json");
    let rows = [...(data[params.syasyu] || []), ...(data[""] || [])];
    if (params.input) {
      const q = String(params.input).replace(/%/g, "");
      rows = rows.filter((r) => r.KIGOU.includes(q));
    }
    return rows;
  }

  if (path === "color/trim-count") {
    const rows = await fetchStatic("color-name.json");
    const code = String(params.code || "");
    let count = 0;
    rows.forEach(([s, n, kubun, c]) => {
      if (s === params.shashu_ctlg && kubun === params.kubun && c === code
          && (!params.nenkai || n === params.nenkai)) count++;
    });
    return { count };
  }

  if (path === "saihai-ym") {
    // JS port of saihai_ym.py (itself a port of SyaryoLogic.js 1227–1368)
    const result = { saiyou_ym: String(params.saiyou_ym || ""),
                     haishi_ym: String(params.haishi_ym || ""),
                     saiyou_ymd: "", haishi_ymd: "", nenkai: null };
    const figNo = params.fig_no ?? null;
    const ymdFor = (fig) => {
      const n = parseInt(fig, 10);
      if (["005","039","055","070","072","073","089","093","096","149","184"].includes(fig))
        return params.bd_seisan_ymd;
      if (["348","732"].includes(fig) || (!isNaN(n) && n >= 0 && n <= 99))
        return params.eg_seisan_ymd;
      if (["190","195"].includes(fig) || (!isNaN(n) && n >= 100 && n <= 188))
        return params.tm_seisan_ymd;
      return params.bd_seisan_ymd;
    };
    if (params.vin_before) {
      const ymd = figNo != null ? ymdFor(figNo) : params.bd_seisan_ymd;
      if (ymd) {
        result.saiyou_ym = ymd.slice(0, 6); result.haishi_ym = ymd.slice(0, 6);
        result.saiyou_ymd = ymd; result.haishi_ymd = ymd;
      }
      return result;
    }
    return result;
  }

  if (path === "model") {
    // GET_MODEL: tokucho-kigou union for a MODEL_POSITION (syaryoSpec source)
    const m = await getCatalogManifest(params.syasyu);
    const spec = m.syaryoSpec || {};
    const saiyouYM = params.saiyou_ym || "000000";
    const haishiYM = params.haishi_ym || "999999";
    const pos = parseInt(params.model_position, 10);
    const positions = (spec.positions || []).filter(
      (r) => String(r.position) === String(params.model_position)
        && String(r.saiyou || "") <= haishiYM && String(r.haishi || "999999") >= saiyouYM);
    if (!positions.length) return [];
    const rows = [];
    const seen = new Set();
    positions.forEach((p) => {
      (p.kigou || []).forEach((kigou, arrIdx) => {
        const kubun_number = arrIdx + 1;
        if (!kigou) return;
        const key = kubun_number + ":" + kigou;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({
          KIGOU: kigou, KUBUN_NUMBER: kubun_number,
          KUBUN_NAME: "", KIGOU_NAME: spec.elemNames[kigou] || "",
          SAIYOU_YM: p.saiyou || "",
          HAISHI_YM: p.haishi && p.haishi !== "" ? p.haishi : "999999",
        });
      });
    });
    return rows.sort((a, b) => a.KUBUN_NUMBER - b.KUBUN_NUMBER);
  }

  if (path === "version-info") {
    return fetchStatic("system.json");
  }

  if (path === "overseas/fig-group-name") {
    const d = await fetchStatic("dic.json");
    const g = String(params.fig_group || "").trim();
    return { fig_group: g, name: (d.figGroup || {})[g] || "" };
  }

  if (path === "overseas/fig-name") {
    const d = await fetchStatic("dic.json");
    const f = String(params.fig_no || "").trim();
    return { fig_no: f, name: (d.fig || {})[f] || "" };
  }

  if (path === "overseas/parts-code-name") {
    const d = await fetchStatic("dic.json");
    const c = String(params.parts_code || "").trim();
    return { parts_code: c, name: (d.partsCode || {})[c] || "" };
  }

  if (path.startsWith("parts/vehicle-dbable/")) {
    const num = path.split("/")[2];
    const data = await fetchStatic("gokan.json");
    return (data[num] || []).map((r) => ({
      ...r, QTY: 1,
      GOKAN_PARTS_NUMBER: r.EXCHANGE_PARTS_NUMBER,
      GOKAN_KUBUN: r.JOKEN,
    }));
  }

  if (path.startsWith("parts/models/")) {
    const num = path.split("/")[2];
    const data = await fetchStatic("models-by-number.json");
    return data[num] || [];
  }

  if (path.startsWith("parts/relation/")) {
    // M_PARTS_NUMBER_NAME_RELATION does not exist in this master DB;
    // queries.select_parts_relation returns [] — parity here.
    return [];
  }

  if (path.startsWith("parts/price-tool/")) {
    // PRICE_TOOL (Windowdata) is empty in this dataset; API returns None too.
    return null;
  }

  throw new Error(`static mode: no handler for ${path}`);
}

// ---------------------------------------------------------------------------
// Entry point: static-aware api() replacement, called by core.js.
// STATIC BUILD: no /api fallback — this distribution is static-only. A miss
// here means the feature genuinely has no static chunk; callers show the error.
// ---------------------------------------------------------------------------

async function staticFirstApi(path, extraParams) {
  if (!staticUIAvailable) return null;
  return staticApi(path, extraParams || {});
}
