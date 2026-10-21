const LS_REPO = "gh-repo";
const LS_TOKEN = "gh-token";
const DEFAULT_REPO = "shalom-lab/epi-watch";
const FAVORITE_PATH = "data/article_favorite.json";

const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V7a2 2 0 0 1 2-2h8"/></svg>`;
const ICON_STAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9 7.2 18.5l.9-5.4-3.9-3.8 5.4-.8L12 3.6z"/></svg>`;

const TAG_META = {
  epidemiology: { label: "流行病学方法", color: "#dbeafe", ink: "#1e40af" },
  "statistical-methods": { label: "统计方法", color: "#ede9fe", ink: "#5b21b6" },
  "causal-inference": { label: "因果推断", color: "#e0e7ff", ink: "#3730a3" },
  "mathematical-model": { label: "数学模型", color: "#fae8ff", ink: "#86198f" },
  "infectious-disease-model": { label: "传染病模型", color: "#fce7f3", ink: "#9d174d" },
  ai: { label: "人工智能", color: "#e0f2fe", ink: "#075985" },
  rsv: { label: "RSV", color: "#d1fae5", ink: "#065f46" },
  influenza: { label: "流感", color: "#ccfbf1", ink: "#0f766e" },
  covid: { label: "COVID", color: "#ffedd5", ink: "#9a3412" },
  "emerging-id": { label: "新发传染病", color: "#ffe4e6", ink: "#9f1239" },
  ve: { label: "疫苗VE", color: "#fde68a", ink: "#78350f" },
  "clinical-trial": { label: "临床试验", color: "#cffafe", ink: "#155e75" },
  "surveillance-outbreak": { label: "监测与暴发", color: "#fee2e2", ink: "#991b1b" },
  "vitamin-d": { label: "维生素D与感染", color: "#fef9c3", ink: "#854d0e" },
  immunity: { label: "人体免疫力", color: "#f3e8ff", ink: "#6b21a8" },
  seasonality: { label: "季节性", color: "#ecfccb", ink: "#3f6212" },
  seroepi: { label: "血清流行病学", color: "#fae8ff", ink: "#86198f" },
  "china-team": { label: "中国团队", color: "#fce7f3", ink: "#9d174d" },
};

const el = (id) => document.getElementById(id);

function asList(v) {
  if (Array.isArray(v)) return v.filter((x) => x != null && String(x).trim().length);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  if (v && typeof v === "object") return [...asList(v.zh), ...asList(v.en)];
  return [];
}

function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    if (v.zh || v.en) {
      const zh = v.zh;
      const en = v.en;
      if (typeof zh === "string" && zh.trim()) return zh.trim();
      if (typeof en === "string" && en.trim()) return en.trim();
      if (zh && typeof zh === "object") {
        const parts = [zh.content, zh.methods, zh.conclusion].filter(Boolean);
        if (parts.length) return parts.join(" ");
      }
      if (en && typeof en === "object") {
        const parts = [en.content, en.methods, en.conclusion].filter(Boolean);
        if (parts.length) return parts.join(" ");
      }
    }
    if (v.content || v.methods || v.conclusion) {
      return [v.content, v.methods, v.conclusion].filter(Boolean).join(" ");
    }
  }
  return "";
}

const state = {
  articles: [],
  journals: [], // [{id, name, count, group, groupLabel, impactFactor}]
  journalMeta: {}, // id -> meta from data/journals-meta.json
  journalGroupOrder: [],
  journalQuery: "",
  selectedJournals: new Set(), // empty = none; all ids = all selected
  selectedTags: new Set(),
  starred: new Set(), // article ids from data/article_favorite.json
  favoriteSha: null, // GitHub contents SHA for optimistic PUT
  starBusy: false,
  onlyStarred: false,
  loaded: false,
  collapsed: new Set(),
};

function readCreds() {
  return {
    repo: (localStorage.getItem(LS_REPO) || "").trim(),
    token: (localStorage.getItem(LS_TOKEN) || "").trim(),
  };
}
function saveCreds(repo, token) {
  localStorage.setItem(LS_REPO, repo.trim());
  localStorage.setItem(LS_TOKEN, token.trim());
}
function clearCreds() {
  localStorage.removeItem(LS_REPO);
  localStorage.removeItem(LS_TOKEN);
}
function hasCreds() {
  const { repo, token } = readCreds();
  return Boolean(repo && token);
}

function favoritePayload() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    ids: [...state.starred].sort(),
  };
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(String(b64 || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function fetchRepoFileMeta(path) {
  const { repo, token } = readCreds();
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new Error("Token 无效或权限不足（精选需要 Contents: Read/Write）。");
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function loadFavorites() {
  try {
    const meta = await fetchRepoFileMeta(FAVORITE_PATH);
    if (!meta) {
      state.starred = new Set();
      state.favoriteSha = null;
      return;
    }
    state.favoriteSha = meta.sha || null;
    const data = JSON.parse(base64ToUtf8(meta.content));
    const ids = Array.isArray(data?.ids) ? data.ids : (Array.isArray(data) ? data : []);
    state.starred = new Set(ids.map(String).filter(Boolean));
  } catch (err) {
    console.warn("article_favorite.json", err);
    state.starred = new Set();
    state.favoriteSha = null;
    throw err;
  }
}

async function saveFavoritesToGithub() {
  const { repo, token } = readCreds();
  const body = {
    message: `chore: update favorites (${state.starred.size})`,
    content: utf8ToBase64(JSON.stringify(favoritePayload(), null, 2) + "\n"),
  };
  if (state.favoriteSha) body.sha = state.favoriteSha;
  const url = `https://api.github.com/repos/${repo}/contents/${FAVORITE_PATH}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Token 无写权限：请给该仓 Contents: Write，才能同步精选。");
  }
  if (res.status === 409) {
    // conflict — reload sha and retry once
    await loadFavorites();
    throw new Error("精选文件有冲突，已重新拉取，请再点一次星标。");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`写入精选失败 GitHub ${res.status}${t ? ": " + t.slice(0, 160) : ""}`);
  }
  const out = await res.json();
  state.favoriteSha = out.content?.sha || state.favoriteSha;
}

async function toggleStar(id) {
  if (state.starBusy) return;
  const key = String(id);
  const prev = new Set(state.starred);
  const prevSha = state.favoriteSha;
  if (state.starred.has(key)) state.starred.delete(key);
  else state.starred.add(key);
  state.starBusy = true;
  try {
    await saveFavoritesToGithub();
  } catch (err) {
    state.starred = prev;
    state.favoriteSha = prevSha;
    throw err;
  } finally {
    state.starBusy = false;
  }
}

function articleById(id) {
  return state.articles.find((a) => a.id === id);
}

function cardCopyText(a) {
  const lines = [];
  lines.push(a.title || "(无标题)");
  lines.push("");
  if (a.journalName || a.journalId) lines.push(`期刊：${a.journalName || a.journalId}`);
  if (a.publishedAt) lines.push(`日期：${a.publishedAt}`);
  if (a.relevanceScore != null) lines.push(`相关度：${a.relevanceScore}`);
  if (a.firstAuthor) lines.push(`一作：${a.firstAuthor}`);
  if (a.correspondingAuthor) lines.push(`通讯：${a.correspondingAuthor}`);
  if (a.authors) lines.push(`作者：${a.authors}`);
  const tags = (a.tags || []).map((t) => (TAG_META[t] && TAG_META[t].label) || t);
  if (tags.length) lines.push(`标签：${tags.join("、")}`);
  const ctx = [a.exposure, a.outcome, a.population, a.site].map((x) => String(x || "").trim()).filter(Boolean);
  if (ctx.length) lines.push(`情境：${ctx.join(" · ")}`);
  const methods = asList(a.statisticalMethods);
  if (methods.length) lines.push(`统计方法：${methods.join("、")}`);
  if (a.highlight) {
    lines.push("");
    lines.push(`亮点：${a.highlight}`);
  }
  if (a.brief) {
    lines.push("");
    lines.push(`摘要：${a.brief}`);
  }
  const points = asList(a.learnPoints);
  if (points.length) {
    lines.push("");
    lines.push("要点：");
    for (const p of points) lines.push(`- ${p}`);
  }
  lines.push("");
  if (a.url) lines.push(`原文：${a.url}`);
  const pubmed = a.pubmedUrl || (a.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/` : "");
  if (pubmed) lines.push(`PubMed：${pubmed}`);
  if (a.doi) lines.push(`DOI：${a.doi}`);
  else if (a.id) lines.push(`ID：${a.id}`);
  return lines.join("\n");
}

async function copyCard(a, btn) {
  const text = cardCopyText(a);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if (btn) {
    btn.classList.add("copied");
    btn.title = "已复制";
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.title = "复制卡片信息";
    }, 1200);
  }
}



function formatUpdatedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ");
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function setDataUpdated(iso) {
  const node = el("data-updated");
  if (!node) return;
  const text = formatUpdatedAt(iso);
  if (!text) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = `数据更新：${text}`;
  node.title = iso;
}

function setStatus(msg, kind = "error") {
  const s = el("status");
  if (!msg) {
    s.hidden = true;
    s.textContent = "";
    return;
  }
  s.hidden = false;
  s.className = kind === "info" ? "status info" : "status";
  s.textContent = msg;
}

function showGate(show) {
  el("gate").hidden = !show;
  el("workspace").hidden = show || !state.loaded;
  el("btn-refresh").hidden = show || !state.loaded;
  const topSearch = el("top-search");
  if (topSearch) topSearch.hidden = show || !state.loaded;
  if (show) {
    const { repo, token } = readCreds();
    el("setup-repo").value = repo || DEFAULT_REPO;
    el("setup-token").value = token || "";
    setDataUpdated("");
  }
}

async function fetchRepoFile(path) {
  const { repo, token } = readCreds();
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Token 无效或权限不足（需要能读该私有仓的 Contents）。");
  }
  if (res.status === 404) throw new Error(`找不到 ${path}，请确认仓库与路径。`);
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

function normalizeArticle(a) {
  return {
    ...a,
    brief: asText(a.brief),
    highlight: asText(a.highlight),
    learnPoints: asList(a.learnPoints),
    outcome: asText(a.outcome),
    exposure: asText(a.exposure),
    population: asText(a.population),
    site: asText(a.site),
    statisticalMethods: asList(a.statisticalMethods),
    reason: asText(a.reason) || a.reason || "",
    tags: (a.tags || []).filter((x) => x && x !== "methods" && x !== "vaccine-epi"),
  };
}

function ifBand(iff) {
  if (iff == null || Number.isNaN(Number(iff))) return "b0";
  const v = Number(iff);
  if (v >= 40) return "b4";
  if (v >= 20) return "b3";
  if (v >= 10) return "b2";
  if (v >= 5) return "b1";
  return "b0";
}

function buildJournalIndex(articles) {
  // Start from all known journals in meta (count 0), then merge article counts.
  const map = new Map();
  for (const [id, meta] of Object.entries(state.journalMeta)) {
    map.set(id, {
      id,
      name: meta.name || id,
      count: 0,
      group: meta.group || "general",
      groupLabel: meta.groupLabel || "综合 / 其他",
      impactFactor: meta.impactFactor ?? null,
    });
  }
  for (const a of articles) {
    const id = a.journalId || "unknown";
    const meta = state.journalMeta[id] || {};
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: meta.name || a.journalName || id,
        count: 0,
        group: meta.group || "general",
        groupLabel: meta.groupLabel || "综合 / 其他",
        impactFactor: meta.impactFactor ?? null,
      });
    }
    map.get(id).count += 1;
  }
  const order = state.journalGroupOrder.length
    ? state.journalGroupOrder
    : ["nejm","lancet","nature","science","jama","bmj","epi","id","respiratory","china","general"];
  const rank = new Map(order.map((g, i) => [g, i]));
  return [...map.values()].sort((a, b) => {
    const ga = rank.has(a.group) ? rank.get(a.group) : 99;
    const gb = rank.has(b.group) ? rank.get(b.group) : 99;
    if (ga !== gb) return ga - gb;
    const ia = a.impactFactor == null ? -1 : a.impactFactor;
    const ib = b.impactFactor == null ? -1 : b.impactFactor;
    if (ib !== ia) return ib - ia;
    return a.name.localeCompare(b.name, "en");
  });
}

function syncAllCheckbox() {
  const all = el("journal-all");
  const total = state.journals.length;
  const n = state.selectedJournals.size;
  all.checked = total > 0 && n === total;
  all.indeterminate = n > 0 && n < total;
}

function renderJournalList() {
  const jCounts = journalCountsForFacets();
  for (const j of state.journals) j.count = jCounts.get(j.id) || 0;
  const totalEl = el("journal-total");
  if (totalEl) {
    const n = state.journals.length;
    const arts = state.journals.reduce((s, j) => s + (j.count || 0), 0);
    totalEl.textContent = n ? `（${n} 刊 · ${arts} 篇）` : "";
  }
  const root = el("journal-list");
  const q = (state.journalQuery || "").trim().toLowerCase();
  const inView = new Set(filteredArticles().map((a) => a.journalId).filter(Boolean));
  const list = q
    ? state.journals.filter((j) => j.name.toLowerCase().includes(q) || j.id.toLowerCase().includes(q) || (j.groupLabel || "").toLowerCase().includes(q))
    : state.journals;

  const chunks = [];
  let lastGroup = null;
  for (const j of list) {
    if (j.groupLabel !== lastGroup) {
      lastGroup = j.groupLabel;
      chunks.push(`<div class="journal-group-title"><span>${esc(j.groupLabel || "其他")}</span><button type="button" class="j-only-group" data-group="${esc(j.group || "")}" title="只选该类" aria-label="只选该类">◎</button></div>`);
    }
    const on = state.selectedJournals.has(j.id);
    const band = ifBand(j.impactFactor);
    const ifHtml = j.impactFactor != null
      ? `<span class="j-if ${band}" title="近似影响因子（仅供颜色映射）">${Number(j.impactFactor).toFixed(1)}</span>`
      : "";
    chunks.push(`<div class="journal-item-row${on ? " on" : ""}${inView.has(j.id) ? " in-view" : ""}">
        <label class="check journal-item">
          <input type="checkbox" data-journal="${esc(j.id)}" ${on ? "checked" : ""} />
          <span class="j-name" title="${esc(j.name)}">${esc(j.name)}</span>
          <span class="j-meta">${ifHtml}<span class="j-count">${j.count}</span></span>
        </label>
        <button type="button" class="j-only" data-journal-only="${esc(j.id)}" title="只看此刊" aria-label="只看此刊">◎</button>
      </div>`);
  }
  root.innerHTML = chunks.length ? chunks.join("") : `<div class="empty" style="padding:12px;font-size:12px">无匹配期刊</div>`;
  syncAllCheckbox();
}

function buildTagBar() {
  // Seed chips from full library so tags stay available; counts refresh with facets.
  const seed = new Map();
  for (const a of state.articles) {
    for (const t of a.tags || []) seed.set(t, true);
  }
  const counts = tagCountsForFacets();
  const bar = el("tag-bar");
  bar.innerHTML = "";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "chip clear" + (state.selectedTags.size ? " active" : "");
  clear.textContent = "清除标签";
  clear.addEventListener("click", () => {
    state.selectedTags.clear();
    renderFiltersChrome();
    renderList();
  });
  bar.appendChild(clear);
  for (const id of [...seed.keys()].sort()) {
    const meta = TAG_META[id] || { label: id, color: "#e2e8f0", ink: "#334155" };
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (state.selectedTags.has(id) ? " on" : "");
    btn.style.background = meta.color;
    btn.style.color = meta.ink;
    btn.dataset.tag = id;
    const n = counts.get(id) || 0;
    btn.textContent = `${meta.label} ${n}`;
    btn.hidden = n === 0 && !state.selectedTags.has(id);
    btn.addEventListener("click", () => {
      if (state.selectedTags.has(id)) state.selectedTags.delete(id);
      else state.selectedTags.add(id);
      renderFiltersChrome();
      renderList();
    });
    bar.appendChild(btn);
  }
}

function renderFiltersChrome() {
  for (const btn of el("tag-bar").querySelectorAll(".chip[data-tag]")) {
    btn.classList.toggle("on", state.selectedTags.has(btn.dataset.tag));
  }
  const clear = el("tag-bar").querySelector(".chip.clear");
  if (clear) clear.classList.toggle("active", state.selectedTags.size > 0);
}


function todayYmdShanghai() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function shiftDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function shiftMonths(ymd, months) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

function articleDate(a) {
  const raw = String(a.publishedAt || "").trim();
  if (!raw) return "";
  // keep YYYY-MM-DD prefix
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : raw.slice(0, 10);
}

function setDatePresetActive(preset) {
  const bar = el("date-presets");
  if (!bar) return;
  for (const btn of bar.querySelectorAll(".date-chip")) {
    btn.classList.toggle("on", btn.dataset.preset === preset);
  }
}

function applyDatePreset(preset, { render = true } = {}) {
  const fromEl = el("date-from");
  const toEl = el("date-to");
  if (!fromEl || !toEl) return;
  const today = todayYmdShanghai();
  if (preset === "all") {
    fromEl.value = "";
    toEl.value = "";
    setDatePresetActive("all");
  } else if (preset === "7d") {
    fromEl.value = shiftDays(today, -7);
    toEl.value = today;
    setDatePresetActive("7d");
  } else if (preset === "1m") {
    fromEl.value = shiftMonths(today, -1);
    toEl.value = today;
    setDatePresetActive("1m");
  } else if (preset === "3m") {
    fromEl.value = shiftMonths(today, -3);
    toEl.value = today;
    setDatePresetActive("3m");
  } else if (preset === "1y") {
    fromEl.value = shiftMonths(today, -12);
    toEl.value = today;
    setDatePresetActive("1y");
  }
  if (render) renderList();
}

function markDateCustomIfNeeded() {
  const bar = el("date-presets");
  if (!bar) return;
  for (const btn of bar.querySelectorAll(".date-chip")) btn.classList.remove("on");
}

function readFilterControls() {
  return {
    minScore: Number(el("filter-score")?.value || 0),
    q: (el("filter-q")?.value || "").trim().toLowerCase(),
    dateFrom: (el("date-from")?.value || "").trim(),
    dateTo: (el("date-to")?.value || "").trim(),
  };
}

function matchScoreDateQuery(a, { minScore, q, dateFrom, dateTo } = readFilterControls()) {
  if ((a.relevanceScore ?? 0) < minScore) return false;
  if (dateFrom || dateTo) {
    const d = articleDate(a);
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
  }
  if (q) {
    const blob = [
      a.title,
      a.highlight,
      a.brief,
      a.doi,
      a.id,
      a.pmid,
      a.reason,
      a.journalName,
      a.journalId,
      a.firstAuthor,
      a.correspondingAuthor,
      a.authors,
      ...asList(a.learnPoints),
      ...asList(a.statisticalMethods),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!blob.includes(q)) return false;
  }
  return true;
}

function matchJournals(a, journals = state.selectedJournals) {
  if (!journals || journals.size === 0) return false;
  if (journals.size >= state.journals.length) return true;
  return journals.has(a.journalId);
}

function matchTags(a, tags = state.selectedTags) {
  if (!tags || !tags.size) return true;
  return (a.tags || []).some((t) => tags.has(t));
}

/** @param {{ journals?: boolean, tags?: boolean, sort?: boolean }} opts */
function filterArticles(opts = {}) {
  const applyJournals = opts.journals !== false;
  const applyTags = opts.tags !== false;
  const doSort = opts.sort !== false;
  const ctrl = readFilterControls();
  let list = state.articles.filter((a) => matchScoreDateQuery(a, ctrl));
  if (applyJournals) list = list.filter((a) => matchJournals(a));
  if (applyTags) list = list.filter((a) => matchTags(a));
  if (state.onlyStarred) list = list.filter((a) => state.starred.has(String(a.id)));
  if (!doSort) return list;
  return list.sort((a, b) => {
    const ds = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (ds) return ds;
    return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
  });
}

function filteredArticles() {
  return filterArticles({ journals: true, tags: true, sort: true });
}

function journalCountsForFacets() {
  // Score/date/search/tags applied; journal checkbox ignored (facet counts).
  const list = filterArticles({ journals: false, tags: true, sort: false });
  const counts = new Map();
  for (const a of list) {
    const id = a.journalId || "unknown";
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function tagCountsForFacets() {
  // Score/date/search/journals applied; tag selection ignored (facet counts).
  const list = filterArticles({ journals: true, tags: false, sort: false });
  const counts = new Map();
  for (const a of list) {
    for (const t of a.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

function refreshFacetCounts() {
  const jCounts = journalCountsForFacets();
  for (const j of state.journals) j.count = jCounts.get(j.id) || 0;

  // Update visible journal row badges + header without full re-render if possible.
  const totalEl = el("journal-total");
  if (totalEl) {
    const n = state.journals.length;
    const arts = state.journals.reduce((s, j) => s + (j.count || 0), 0);
    totalEl.textContent = n ? `（${n} 刊 · ${arts} 篇）` : "";
  }
  for (const row of el("journal-list")?.querySelectorAll(".journal-item-row") || []) {
    const input = row.querySelector("input[data-journal]");
    const badge = row.querySelector(".j-count");
    if (!input || !badge) continue;
    badge.textContent = String(jCounts.get(input.dataset.journal) || 0);
  }

  const tCounts = tagCountsForFacets();
  const bar = el("tag-bar");
  if (!bar) return;
  for (const btn of bar.querySelectorAll(".chip[data-tag]")) {
    const id = btn.dataset.tag;
    const meta = TAG_META[id] || { label: id };
    const n = tCounts.get(id) || 0;
    btn.textContent = `${meta.label} ${n}`;
    btn.hidden = n === 0 && !state.selectedTags.has(id);
  }
}

function pill(tag) {
  const meta = TAG_META[tag] || { label: tag, color: "#e2e8f0", ink: "#334155" };
  return `<span class="pill" style="background:${meta.color};color:${meta.ink}">${meta.label}</span>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function pubmedAuthorUrl(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(n + "[Author]")}`;
}


function correspondingAuthorLinks(a) {
  const raw = a.correspondingAuthor || "";
  const parts = String(raw).split(/;|；/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "";
  const links = parts.map((n) => `<a class="author-name-link" href="${esc(pubmedAuthorUrl(n))}" target="_blank" rel="noopener">${esc(n)}</a>`).join("；");
  return `<span class="author-line"><span class="author-label">通讯</span> ${links}</span>`;
}



function epiContextRow(a) {
  const parts = [a.exposure, a.outcome, a.population, a.site]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  return `<div class="ctx-row"><span class="ctx-block">${parts.map(esc).join(" · ")}</span></div>`;
}

function cardHtml(a) {
  const score = a.relevanceScore ?? 0;
  const scoreClass = score >= 0.55 ? "score" : "score mid";
  const tags = (a.tags || []).map(pill).join("");
  const links = [];
  if (a.url) links.push(`<a href="${esc(a.url)}" target="_blank" rel="noopener">原文</a>`);
  if (a.pubmedUrl) links.push(`<a href="${esc(a.pubmedUrl)}" target="_blank" rel="noopener">PubMed</a>`);
  else if (a.pmid) links.push(`<a href="https://pubmed.ncbi.nlm.nih.gov/${esc(a.pmid)}/" target="_blank" rel="noopener">PubMed</a>`);
  const collapsed = state.collapsed.has(a.id);
  const points = asList(a.learnPoints)
    .slice(0, 3)
    .map((p) => `<li>${esc(p)}</li>`)
    .join("");
  const methods = asList(a.statisticalMethods)
    .slice(0, 6)
    .map((m) => `<span class="method-chip">${esc(m)}</span>`)
    .join("");

  const starred = state.starred.has(String(a.id));
  return `
  <article class="card${starred ? " starred" : ""}" data-id="${esc(a.id)}">
    <h3><a href="${esc(a.url || (a.doi ? "https://doi.org/" + a.doi : "#"))}" target="_blank" rel="noopener">${esc(a.title || "(无标题)")}</a></h3>
    <div class="meta">
      <span>${esc(a.journalName || a.journalId || "")}</span>
      <span>${esc(a.publishedAt || "")}</span>
      <span class="${scoreClass}">${score.toFixed(2)}</span>
      ${a.firstAuthor ? `<span class="author-line"><span class="author-label">一作</span> <a class="author-name-link" href="${esc(pubmedAuthorUrl(a.firstAuthor))}" target="_blank" rel="noopener">${esc(a.firstAuthor)}</a></span>` : (a.authors ? `<span>${esc(a.authors)}</span>` : "")}
      ${correspondingAuthorLinks(a)}
    </div>
    ${tags ? `<div class="tags">${tags}</div>` : ""}
    ${epiContextRow(a)}
    ${methods ? `<div class="methods-row"><span class="methods-label">统计方法</span>${methods}</div>` : ""}
    ${a.highlight ? `<div class="highlight"><p>${esc(a.highlight)}</p></div>` : ""}
    <div class="links">
      ${links.join("")}
      <span class="icon-btns">
        <button type="button" class="icon-btn copy" data-copy="${esc(a.id)}" title="复制卡片信息" aria-label="复制">${ICON_COPY}</button>
        <button type="button" class="icon-btn star${starred ? " on" : ""}" data-star="${esc(a.id)}" title="${starred ? "取消精选" : "精选"}" aria-label="精选" aria-pressed="${starred ? "true" : "false"}">${ICON_STAR}</button>
      </span>
      <button type="button" class="expand" data-toggle>${collapsed ? "展开" : "收起"}</button>
    </div>
    <div class="detail${collapsed ? " collapsed" : ""}">
      ${a.brief ? `<p class="brief-text">${esc(a.brief)}</p>` : ""}
      ${points ? `<ul class="points">${points}</ul>` : ""}
    </div>
      </article>`;
}


function updateJournalInViewHighlights() {
  const root = el("journal-list");
  if (!root) return;
  const inView = new Set(filteredArticles().map((a) => a.journalId).filter(Boolean));
  for (const row of root.querySelectorAll(".journal-item-row")) {
    const input = row.querySelector("input[data-journal]");
    const id = input?.dataset.journal;
    row.classList.toggle("in-view", !!(id && inView.has(id)));
  }
}

function renderList() {
  refreshFacetCounts();
  const list = filteredArticles();
  // Denominator: same filters except tags (so journal-only view matches sidebar).
  const scoped = filterArticles({ journals: true, tags: false, sort: false });
  el("count").textContent = `${list.length} / ${scoped.length}`;
  const root = el("list");
  if (!list.length) {
    root.innerHTML = `<div class="empty">没有匹配的文章</div>`;
    updateJournalInViewHighlights();
    return;
  }
  root.innerHTML = list.map(cardHtml).join("");
  updateJournalInViewHighlights();
}

function wireListClicks() {
  el("list").addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      e.preventDefault();
      const id = copyBtn.dataset.copy;
      const a = articleById(id);
      if (a) copyCard(a, copyBtn);
      return;
    }
    const starBtn = e.target.closest("[data-star]");
    if (starBtn) {
      e.preventDefault();
      if (state.starBusy || starBtn.disabled) return;
      const id = starBtn.dataset.star;
      const card = starBtn.closest(".card");
      starBtn.disabled = true;
      setStatus("正在同步精选到 GitHub…", "info");
      toggleStar(id)
        .then(() => {
          const on = state.starred.has(String(id));
          starBtn.classList.toggle("on", on);
          starBtn.setAttribute("aria-pressed", on ? "true" : "false");
          starBtn.title = on ? "取消精选" : "精选";
          card?.classList.toggle("starred", on);
          setStatus("");
          if (state.onlyStarred) renderList();
          else refreshFacetCounts();
        })
        .catch((err) => {
          const on = state.starred.has(String(id));
          starBtn.classList.toggle("on", on);
          card?.classList.toggle("starred", on);
          setStatus(err.message || String(err));
        })
        .finally(() => {
          starBtn.disabled = false;
        });
      return;
    }
    const btn = e.target.closest("[data-toggle]");
    if (!btn) return;
    const card = btn.closest(".card");
    const id = card?.dataset.id;
    if (!id) return;
    if (state.collapsed.has(id)) state.collapsed.delete(id);
    else state.collapsed.add(id);
    const detail = card.querySelector(".detail");
    const collapsed = state.collapsed.has(id);
    detail.classList.toggle("collapsed", collapsed);
    btn.textContent = collapsed ? "展开" : "收起";
  });
}

function wireJournalSidebar() {
  el("journal-all").addEventListener("change", (e) => {
    if (e.target.checked) {
      state.selectedJournals = new Set(state.journals.map((j) => j.id));
    } else {
      state.selectedJournals.clear();
    }
    renderJournalList();
    renderList();
  });

  el("journal-list").addEventListener("change", (e) => {
    const input = e.target.closest("input[data-journal]");
    if (!input) return;
    const id = input.dataset.journal;
    if (input.checked) state.selectedJournals.add(id);
    else state.selectedJournals.delete(id);
    // keep scroll: only update chrome for this item
    input.closest(".journal-item-row")?.classList.toggle("on", input.checked);
    syncAllCheckbox();
    renderList();
  });

  el("journal-q").addEventListener("input", (e) => {
    state.journalQuery = e.target.value || "";
    const btn = el("journal-only-matches");
    if (btn) btn.hidden = !(state.journalQuery || "").trim();
    renderJournalList();
  });
  el("journal-only-matches")?.addEventListener("click", () => {
    const q = (state.journalQuery || "").trim().toLowerCase();
    if (!q) return;
    const matched = state.journals.filter((j) =>
      j.name.toLowerCase().includes(q) || j.id.toLowerCase().includes(q) || (j.groupLabel || "").toLowerCase().includes(q)
    );
    state.selectedJournals = new Set(matched.map((j) => j.id));
    renderJournalList();
    renderList();
  });

  el("journal-list").addEventListener("click", (e) => {
    const only = e.target.closest("[data-journal-only]");
    if (only) {
      e.preventDefault();
      const id = only.dataset.journalOnly;
      state.selectedJournals = new Set([id]);
      renderJournalList();
      renderList();
      return;
    }
    const grp = e.target.closest("[data-group]");
    if (grp && grp.classList.contains("j-only-group")) {
      e.preventDefault();
      const g = grp.dataset.group;
      state.selectedJournals = new Set(state.journals.filter((j) => j.group === g).map((j) => j.id));
      renderJournalList();
      renderList();
    }
  });
}

async function loadJournalMeta() {
  try {
    const meta = await fetchRepoFile("data/journals-meta.json");
    const map = {};
    for (const j of meta.journals || []) map[j.id] = j;
    state.journalMeta = map;
    state.journalGroupOrder = meta.groupOrder || [];
  } catch (err) {
    // meta is optional; sidebar still works alphabetically via fallback group
    console.warn("journals-meta.json", err);
    state.journalMeta = {};
    state.journalGroupOrder = [];
  }
}

async function loadArticles() {
  setStatus("正在从 GitHub 拉取…", "info");
  await loadJournalMeta();
  try {
    await loadFavorites();
  } catch (err) {
    // Favorites optional on first paint if file missing; hard errors still surface.
    if (!String(err.message || "").includes("找不到") && !String(err.message || err).includes("404")) {
      console.warn(err);
    }
  }
  const data = await fetchRepoFile("data/articles.json");
  state.articles = (Array.isArray(data.articles) ? data.articles : []).map(normalizeArticle);
  const prev = new Set(state.selectedJournals);
  const first = !state.loaded;
  state.journals = buildJournalIndex(state.articles);
  const ids = state.journals.map((j) => j.id);
  if (first || !prev.size) {
    state.selectedJournals = new Set(ids);
  } else {
    const next = new Set(ids.filter((id) => prev.has(id)));
    for (const id of ids) if (!prev.has(id)) next.add(id); // new journals on
    state.selectedJournals = next;
  }
  state.loaded = true;
  state.collapsed.clear();
  setDataUpdated(data.updatedAt);
  renderJournalList();
  buildTagBar();
  el("workspace").hidden = false;
  el("btn-refresh").hidden = false;
  const topSearch = el("top-search");
  if (topSearch) topSearch.hidden = false;
  renderList();
  setStatus("");
}

function openSettings() {
  const { repo, token } = readCreds();
  el("set-repo").value = repo || DEFAULT_REPO;
  el("set-token").value = token || "";
  el("settings-dialog").showModal();
}

function bindToggle(btnId, inputId) {
  el(btnId).addEventListener("click", () => {
    const input = el(inputId);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    el(btnId).textContent = show ? "隐藏" : "显示";
  });
}

function init() {
  bindToggle("toggle-setup-token", "setup-token");
  bindToggle("toggle-set-token", "set-token");
  wireListClicks();
  wireJournalSidebar();

  el("setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const repo = el("setup-repo").value.trim() || DEFAULT_REPO;
    const token = el("setup-token").value.trim();
    if (!token) {
      setStatus("请填写 gh-token");
      return;
    }
    saveCreds(repo, token);
    showGate(false);
    try {
      await loadArticles();
    } catch (err) {
      showGate(true);
      setStatus(err.message || String(err));
    }
  });

  el("btn-settings").addEventListener("click", openSettings);
  el("btn-refresh").addEventListener("click", async () => {
    try {
      await loadArticles();
    } catch (err) {
      setStatus(err.message || String(err));
    }
  });

  el("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = e.submitter?.value;
    const dialog = el("settings-dialog");
    if (value === "cancel") {
      dialog.close();
      return;
    }
    if (value === "save") {
      const repo = el("set-repo").value.trim() || DEFAULT_REPO;
      const token = el("set-token").value.trim();
      if (!repo || !token) {
        setStatus("设置里 gh-repo 与 gh-token 都需要填写");
        dialog.close();
        showGate(true);
        return;
      }
      saveCreds(repo, token);
      dialog.close();
      showGate(false);
      try {
        await loadArticles();
      } catch (err) {
        showGate(true);
        setStatus(err.message || String(err));
      }
    }
  });

  el("btn-clear").addEventListener("click", (e) => {
    e.preventDefault();
    clearCreds();
    state.articles = [];
    state.loaded = false;
    setDataUpdated("");
    el("settings-dialog").close();
    setStatus("");
    showGate(true);
  });

  for (const id of ["filter-score", "filter-q"]) {
    const node = el(id);
    if (!node) continue;
    node.addEventListener("input", renderList);
    node.addEventListener("change", renderList);
  }
  const starFilter = el("filter-starred");
  if (starFilter) {
    starFilter.checked = !!state.onlyStarred;
    starFilter.addEventListener("change", () => {
      state.onlyStarred = starFilter.checked;
      renderList();
    });
  }



  const presets = el("date-presets");
  if (presets) {
    presets.addEventListener("click", (e) => {
      const btn = e.target.closest(".date-chip");
      if (!btn) return;
      applyDatePreset(btn.dataset.preset);
    });
  }
  for (const id of ["date-from", "date-to"]) {
    const node = el(id);
    if (!node) continue;
    node.addEventListener("change", () => {
      markDateCustomIfNeeded();
      renderList();
    });
  }

  if (!hasCreds()) {
    showGate(true);
  } else {
    showGate(false);
    loadArticles().catch((err) => {
      showGate(true);
      setStatus(err.message || String(err));
    });
  }
}

init();
