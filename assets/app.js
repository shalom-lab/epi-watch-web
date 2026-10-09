const LS_REPO = "gh-repo";
const LS_TOKEN = "gh-token";
const DEFAULT_REPO = "shalom-lab/epi-watch";

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
  if (show) {
    const { repo, token } = readCreds();
    el("setup-repo").value = repo || DEFAULT_REPO;
    el("setup-token").value = token || "";
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
  const map = new Map();
  for (const a of articles) {
    const id = a.journalId || "unknown";
    const meta = state.journalMeta[id] || {};
    const name = meta.name || a.journalName || id;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name,
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
    : ["nejm","lancet","nature","science","jama","bmj","epi","id","respiratory","general"];
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
      chunks.push(`<div class="journal-group-title"><span>${esc(j.groupLabel || "其他")}</span><button type="button" class="j-only-group" data-group="${esc(j.group || "")}" title="只选该类" aria-label="只选该类">▣</button></div>`);
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

function buildTagBar(articles) {
  const counts = new Map();
  for (const a of articles) {
    for (const t of a.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const bar = el("tag-bar");
  bar.innerHTML = "";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "chip clear";
  clear.textContent = "清除标签";
  clear.addEventListener("click", () => {
    state.selectedTags.clear();
    renderFiltersChrome();
    renderList();
  });
  bar.appendChild(clear);
  for (const id of [...counts.keys()].sort()) {
    const meta = TAG_META[id] || { label: id, color: "#e2e8f0", ink: "#334155" };
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (state.selectedTags.has(id) ? " on" : "");
    btn.style.background = meta.color;
    btn.style.color = meta.ink;
    btn.dataset.tag = id;
    btn.textContent = `${meta.label} ${counts.get(id)}`;
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
}

function filteredArticles() {
  const minScore = Number(el("filter-score").value);
  const q = el("filter-q").value.trim().toLowerCase();
  let list = state.articles.filter((a) => (a.relevanceScore ?? 0) >= minScore);
  if (state.selectedJournals.size === 0) list = [];
  else if (state.selectedJournals.size < state.journals.length) {
    list = list.filter((a) => state.selectedJournals.has(a.journalId));
  }
  if (state.selectedTags.size) {
    list = list.filter((a) => (a.tags || []).some((t) => state.selectedTags.has(t)));
  }
  if (q) {
    list = list.filter((a) => {
      const blob = [a.title, a.highlight, a.brief, a.doi, a.id, a.reason, ...asList(a.learnPoints), ...asList(a.statisticalMethods)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }
  return list.sort((a, b) => {
    const ds = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (ds) return ds;
    return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
  });
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
  const parts = [a.outcome, a.exposure, a.population, a.site]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const chips = parts.map((p) => `<span class="ctx-chip">${esc(p)}</span>`).join('<span class="ctx-dot">·</span>');
  return `<div class="ctx-row">${chips}</div>`;
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

  return `
  <article class="card" data-id="${esc(a.id)}">
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
  const list = filteredArticles();
  el("count").textContent = `${list.length} / ${state.articles.length}`;
  const root = el("list");
  if (!list.length) {
    root.innerHTML = `<div class="empty">没有匹配的文章</div>`;
    return;
  }
  root.innerHTML = list.map(cardHtml).join("");
  updateJournalInViewHighlights();
}

function wireListClicks() {
  el("list").addEventListener("click", (e) => {
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
    renderJournalList();
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
  renderJournalList();
  buildTagBar(state.articles);
  el("workspace").hidden = false;
  el("btn-refresh").hidden = false;
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
    el("settings-dialog").close();
    setStatus("");
    showGate(true);
  });

  for (const id of ["filter-score", "filter-q"]) {
    el(id).addEventListener("input", renderList);
    el(id).addEventListener("change", renderList);
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
