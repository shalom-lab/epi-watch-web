const LS_REPO = "gh-repo";
const LS_TOKEN = "gh-token";
const DEFAULT_REPO = "shalom-lab/epi-watch";

const TAG_META = {
  epidemiology: { label: "流行病学", color: "#dbeafe", ink: "#1e40af" },
  methods: { label: "方法", color: "#e0e7ff", ink: "#3730a3" },
  "statistical-methods": { label: "统计方法", color: "#ede9fe", ink: "#5b21b6" },
  "mathematical-model": { label: "数学模型", color: "#fae8ff", ink: "#86198f" },
  "infectious-disease-model": { label: "传染病模型", color: "#fce7f3", ink: "#9d174d" },
  rsv: { label: "RSV", color: "#d1fae5", ink: "#065f46" },
  influenza: { label: "流感", color: "#ccfbf1", ink: "#0f766e" },
  covid: { label: "COVID", color: "#ffedd5", ink: "#9a3412" },
  "vaccine-epi": { label: "疫苗流行病学", color: "#fef3c7", ink: "#92400e" },
  "surveillance-outbreak": { label: "监测与暴发", color: "#fee2e2", ink: "#991b1b" },
};

const el = (id) => document.getElementById(id);

function asList(v) {
  if (Array.isArray(v)) return v.filter((x) => x != null && String(x).length);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}



const state = {
  articles: [],
  selectedTags: new Set(),
  loaded: false,
  collapsed: new Set(), // ids collapsed; default = expanded
};

function readCreds() {
  const repo = (localStorage.getItem(LS_REPO) || "").trim();
  const token = (localStorage.getItem(LS_TOKEN) || "").trim();
  return { repo, token };
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
  el("filters").hidden = show || !state.loaded;
  el("list").hidden = show || !state.loaded;
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
  if (res.status === 404) {
    throw new Error(`找不到 ${path}，请确认仓库与路径。`);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

/** Normalize legacy flat brief / highlight / learnPoints → bilingual */
function normalizeArticle(a) {
  const out = { ...a };
  const b = a.brief || {};
  if (b.zh || b.en) {
    out.brief = {
      zh: { content: b.zh?.content || "", methods: b.zh?.methods || "", conclusion: b.zh?.conclusion || "" },
      en: { content: b.en?.content || "", methods: b.en?.methods || "", conclusion: b.en?.conclusion || "" },
    };
  } else {
    const flat = {
      content: b.content || "",
      methods: b.methods || "",
      conclusion: b.conclusion || "",
    };
    const sample = flat.content + flat.methods + flat.conclusion;
    const cjk = /[\u4e00-\u9fff]/.test(sample);
    out.brief = cjk
      ? { zh: flat, en: { content: "", methods: "", conclusion: "" } }
      : { zh: { content: "", methods: "", conclusion: "" }, en: flat };
  }

  const h = a.highlight;
  if (typeof h === "string") {
    out.highlight = /[\u4e00-\u9fff]/.test(h) ? { zh: h, en: "" } : { zh: "", en: h };
  } else if (h && typeof h === "object") {
    out.highlight = { zh: h.zh || "", en: h.en || "" };
  } else {
    out.highlight = { zh: "", en: "" };
  }

  const lp = a.learnPoints;
  if (Array.isArray(lp)) {
    const cjk = lp.some((x) => /[\u4e00-\u9fff]/.test(String(x)));
    out.learnPoints = cjk ? { zh: asList(lp), en: [] } : { zh: [], en: asList(lp) };
  } else if (lp && typeof lp === "object") {
    out.learnPoints = { zh: asList(lp.zh), en: asList(lp.en) };
  } else {
    out.learnPoints = { zh: [], en: [] };
  }
  return out;
}

function journalOptions(articles) {
  const map = new Map();
  for (const a of articles) {
    const id = a.journalId || "unknown";
    const name = a.journalName || id;
    if (!map.has(id)) map.set(id, name);
  }
  return [...map.entries()].sort((x, y) => x[1].localeCompare(y[1], "zh"));
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

  for (const id of [...counts.keys()].sort((a, b) => a.localeCompare(b))) {
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
  const journal = el("filter-journal").value;
  const minScore = Number(el("filter-score").value);
  const q = el("filter-q").value.trim().toLowerCase();
  let list = state.articles.filter((a) => (a.relevanceScore ?? 0) >= minScore);
  if (journal) list = list.filter((a) => a.journalId === journal);
  if (state.selectedTags.size) {
    list = list.filter((a) => (a.tags || []).some((t) => state.selectedTags.has(t)));
  }
  if (q) {
    list = list.filter((a) => {
      const b = a.brief || { zh: {}, en: {} };
      const blob = [
        a.title,
        a.highlight?.zh,
        a.highlight?.en,
        a.doi,
        a.id,
        a.reason,
        b.zh?.content,
        b.zh?.methods,
        b.zh?.conclusion,
        b.en?.content,
        b.en?.methods,
        b.en?.conclusion,
        ...asList(a.learnPoints?.zh),
        ...asList(a.learnPoints?.en),
      ]
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

function bilingualBlock(enText, zhText) {
  const en = (enText || "").trim();
  const zh = (zhText || "").trim();
  if (!en && !zh) return `<div class="lang-block"><p>—</p></div>`;
  let html = `<div class="bilingual">`;
  if (en) {
    html += `<div class="lang-block en"><div class="lang-tag">EN</div><p>${esc(en)}</p></div>`;
  }
  if (zh) {
    html += `<div class="lang-block zh"><div class="lang-tag">中文</div><p>${esc(zh)}</p></div>`;
  }
  html += `</div>`;
  return html;
}

function highlightHtml(h) {
  const en = (h?.en || "").trim();
  const zh = (h?.zh || "").trim();
  if (!en && !zh) return "";
  return `<div class="highlight"><div class="lang-pair">${bilingualBlock(en, zh)}</div></div>`;
}

function learnPointsHtml(lp) {
  const en = asList(lp?.en);
  const zh = asList(lp?.zh);
  if (!en.length && !zh.length) return "";
  let html = `<div class="section"><div class="section-label">可学习点</div><div class="bilingual">`;
  if (en.length) {
    html += `<div class="lang-block en"><div class="lang-tag">EN</div><ul>${en.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
  }
  if (zh.length) {
    html += `<div class="lang-block zh"><div class="lang-tag">中文</div><ul>${zh.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
  }
  html += `</div></div>`;
  return html;
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
  const brief = a.brief || { zh: {}, en: {} };

  return `
  <article class="card" data-id="${esc(a.id)}">
    <h3><a href="${esc(a.url || (a.doi ? "https://doi.org/" + a.doi : "#"))}" target="_blank" rel="noopener">${esc(a.title || "(无标题)")}</a></h3>
    <div class="meta">
      <span>${esc(a.journalName || a.journalId || "")}</span>
      <span>${esc(a.publishedAt || "")}</span>
      <span class="${scoreClass}">${score.toFixed(2)}</span>
      ${a.authors ? `<span>${esc(a.authors)}</span>` : ""}
    </div>
    ${tags ? `<div class="tags">${tags}</div>` : ""}
    ${highlightHtml(a.highlight)}
    <div class="links">
      ${links.join("")}
      <button type="button" class="expand" data-toggle>${collapsed ? "展开摘要" : "收起摘要"}</button>
    </div>
    <div class="detail${collapsed ? " collapsed" : ""}">
      <div class="section">
        <div class="section-label">内容</div>
        ${bilingualBlock(brief.en?.content, brief.zh?.content)}
      </div>
      <div class="section">
        <div class="section-label">方法</div>
        ${bilingualBlock(brief.en?.methods, brief.zh?.methods)}
      </div>
      <div class="section">
        <div class="section-label">结论</div>
        ${bilingualBlock(brief.en?.conclusion, brief.zh?.conclusion)}
      </div>
      ${a.reason ? `<div class="section"><div class="section-label">纳入理由</div><div class="lang-block"><p>${esc(a.reason)}</p></div></div>` : ""}
      ${learnPointsHtml(a.learnPoints)}
    </div>
  </article>`;
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
    btn.textContent = collapsed ? "展开摘要" : "收起摘要";
  });
}

function fillJournalSelect(articles) {
  const sel = el("filter-journal");
  const cur = sel.value;
  sel.innerHTML =
    `<option value="">全部期刊</option>` +
    journalOptions(articles)
      .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`)
      .join("");
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

async function loadArticles() {
  setStatus("正在从 GitHub 拉取…", "info");
  const data = await fetchRepoFile("data/articles.json");
  const raw = Array.isArray(data.articles) ? data.articles : [];
  state.articles = raw.map(normalizeArticle);
  state.loaded = true;
  state.collapsed.clear();
  fillJournalSelect(state.articles);
  buildTagBar(state.articles);
  el("filters").hidden = false;
  el("list").hidden = false;
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

  for (const id of ["filter-journal", "filter-score", "filter-q"]) {
    el(id).addEventListener("input", renderList);
    el(id).addEventListener("change", renderList);
  }

  if (!hasCreds()) {
    showGate(true);
    setStatus("");
  } else {
    showGate(false);
    loadArticles().catch((err) => {
      showGate(true);
      setStatus(err.message || String(err));
    });
  }
}

init();
