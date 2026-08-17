let citySelect = document.querySelector("#citySelect");
const refreshButton = document.querySelector("#refreshButton");
const lastUpdated = document.querySelector("#lastUpdated");
const currentCity = document.querySelector("#currentCity");
const historySince = document.querySelector("#historySince");
const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const searchSummary = document.querySelector("#searchSummary");
const searchResults = document.querySelector("#searchResults");
const boardTemplate = document.querySelector("#boardTemplate");
const searchItemTemplate = document.querySelector("#searchItemTemplate");
let boardsGrid = document.querySelector("#boardsGrid");
let douyinTabs = document.querySelector("#douyinTabs");
let douyinBoardHost = document.querySelector("#douyinBoardHost");
let otherTabs = document.querySelector("#otherTabs");
let otherBoardHost = document.querySelector("#otherBoardHost");

const DEFAULT_CITY_CODE = "310000";
const DOUYIN_TAB_ORDER = ["total", "local", "entertainment", "seeding", "heating", "challenge", "rising"];
const OTHER_PLATFORM_ORDER = ["weibo", "xiaohongshu", "kuaishou", "baidu"];

let currentCityCode = DEFAULT_CITY_CODE;
let autoRefreshTimer = null;
let cityRefreshTimer = null;
let latestPayload = null;
let activeDouyinTab = "total";
let activeOtherPlatform = "weibo";

async function readJson(response) {
  const text = await response.text();

  if (!response.ok) {
    let detail = `请求失败（${response.status}）`;
    if (text.trim()) {
      try {
        const payload = JSON.parse(text);
        detail = payload.message || detail;
      } catch {
        detail = text.trim().slice(0, 160) || detail;
      }
    }
    throw new Error(detail);
  }

  if (!text.trim()) {
    throw new Error("服务返回了空响应，请稍后重试");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("服务返回的数据格式异常，请刷新页面后重试");
  }
}

async function fetchJsonWithRetry(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      return await readJson(response);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("请求失败");
}

function formatDateTime(value) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatHot(item) {
  if (item.hotText) return item.hotText;
  if (typeof item.hot === "number" && Number.isFinite(item.hot) && item.hot > 0) {
    if (item.hot >= 100000000) return `${(item.hot / 100000000).toFixed(1)}亿`;
    if (item.hot >= 10000) return `${(item.hot / 10000).toFixed(1)}w`;
    return `${item.hot}`;
  }
  return "实时";
}

function relativeTime(value) {
  if (!value) return "暂无";
  const diff = Date.now() - value;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeKeyword(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, "");
}

function buildSearchTokens(value = "") {
  const normalized = normalizeKeyword(value);
  if (!normalized) return [];

  const tokens = new Set([normalized]);
  if (normalized.length >= 2) {
    for (let size = Math.min(4, normalized.length); size >= 2; size -= 1) {
      for (let index = 0; index <= normalized.length - size; index += 1) {
        tokens.add(normalized.slice(index, index + size));
      }
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

function ensureLayout() {
  const boardsSection = document.querySelector(".boards-section");

  if (boardsSection && !document.querySelector("#otherTabs")) {
    boardsSection.innerHTML = `
      <div class="section-head">
        <h2>实时榜单</h2>
      </div>
      <section class="platform-section platform-douyin">
        <div class="platform-head">
          <div>
            <p class="platform-kicker">抖音</p>
            <h2>抖音热点区块</h2>
          </div>
          <div class="platform-controls">
            <label class="field compact">
              <span>同城地区</span>
              <select id="citySelectDynamic"></select>
            </label>
          </div>
        </div>
        <div id="douyinTabs" class="tab-row"></div>
        <div id="douyinBoardHost"></div>
      </section>
      <section class="platform-section">
        <div class="platform-head">
          <div>
            <p class="platform-kicker">其他平台</p>
            <h2>其他平台热搜</h2>
          </div>
        </div>
        <div id="otherTabs" class="tab-row"></div>
        <div id="otherBoardHost"></div>
      </section>
    `;
  }

  const oldCityField = document.querySelector(".hero-actions .field");
  if (oldCityField) {
    oldCityField.style.display = "none";
  }

  const searchDesc = document.querySelector(".search-head p");
  if (searchDesc) {
    searchDesc.textContent = "接口失败时会自动重试，并用当前榜单做兜底搜索。";
  }

  const heroTitle = document.querySelector(".hero h1");
  if (heroTitle) {
    heroTitle.textContent = "多平台热点监控";
  }

  const heroText = document.querySelector(".hero-text");
  if (heroText) {
    heroText.textContent = "聚合抖音、微博、小红书、快手、百度热点，并支持近 15 日搜索。";
  }

  citySelect = document.querySelector("#citySelectDynamic") || document.querySelector("#citySelect");
  boardsGrid = document.querySelector("#boardsGrid");
  douyinTabs = document.querySelector("#douyinTabs");
  douyinBoardHost = document.querySelector("#douyinBoardHost");
  otherTabs = document.querySelector("#otherTabs");
  otherBoardHost = document.querySelector("#otherBoardHost");
}

function setLoading(loading) {
  refreshButton.disabled = loading;
  refreshButton.textContent = loading ? "刷新中..." : "立即刷新";
}

function buildDouyinSearchUrl(title) {
  return `https://www.douyin.com/search/${encodeURIComponent(title)}`;
}

function renderBoard(board) {
  const node = boardTemplate.content.firstElementChild.cloneNode(true);
  const displayLimit = board.displayLimit || 15;
  const visibleItems = (board.items || []).slice(0, displayLimit);

  node.querySelector(".board-platform").textContent = board.platformLabel;
  node.querySelector(".board-title").textContent =
    board.board === "local" && board.cityName ? `${board.boardLabel} · ${board.cityName}` : board.boardLabel;
  node.querySelector(".board-meta").textContent = `${visibleItems.length}/${board.items.length} 条`;
  node.querySelector(".board-updated").textContent = `更新于 ${formatDateTime(board.updatedAt)} · ${relativeTime(board.updatedAt)}${
    board.note ? ` · ${board.note}` : ""
  }`;

  const tableSlot = node.querySelector(".board-table");
  if (!board.items?.length) {
    tableSlot.innerHTML = '<div class="board-empty">当前暂无数据</div>';
    return node;
  }

  const rows = visibleItems
    .map((item) => {
      const extraLink =
        board.platform === "douyin" && item.detailUrl
          ? `<a class="minor-link" href="${item.detailUrl}" target="_blank" rel="noreferrer">查看排名</a>`
          : board.detailUrl && item.detailUrl
            ? `<a class="minor-link" href="${item.detailUrl}" target="_blank" rel="noreferrer">详情</a>`
          : "";

      return `
        <tr>
          <td><span class="rank-badge">${item.rank}</span></td>
          <td>
            <div class="topic-cell">
              <a class="topic-link" href="${item.searchUrl || item.mobileUrl || item.url}" target="_blank" rel="noreferrer">
                ${escapeHtml(item.title)}
              </a>
              ${extraLink}
            </div>
          </td>
          <td class="hot-value">${escapeHtml(formatHot(item))}</td>
        </tr>
      `;
    })
    .join("");

  tableSlot.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>排名</th>
          <th>热点词</th>
          <th>热度</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  return node;
}

function renderCitySelect(presets) {
  if (!citySelect) return;
  citySelect.innerHTML = (presets || [])
    .map((item) => `<option value="${item.code}" ${item.code === currentCityCode ? "selected" : ""}>${item.name}</option>`)
    .join("");
}

function getBoardByKey(platform, boardName) {
  return latestPayload?.boards?.find((item) => item.platform === platform && item.board === boardName) || null;
}

function renderDouyinTabs() {
  const boards = DOUYIN_TAB_ORDER.map((name) => getBoardByKey("douyin", name)).filter(Boolean);

  if (!boards.length) {
    douyinTabs.innerHTML = "";
    douyinBoardHost.innerHTML = '<div class="board-empty">抖音榜单暂时不可用</div>';
    return;
  }

  if (!boards.some((board) => board.board === activeDouyinTab)) {
    activeDouyinTab = boards[0].board;
  }

  douyinTabs.innerHTML = boards
    .map((board) => {
      const label = board.board === "local" && board.cityName ? `${board.boardLabel} · ${board.cityName}` : board.boardLabel;
      return `<button class="tab-button ${board.board === activeDouyinTab ? "active" : ""}" data-board="${board.board}">
        ${escapeHtml(label)} <span>(${Math.min(board.items.length, board.displayLimit || board.items.length)})</span>
      </button>`;
    })
    .join("");

  const activeBoard = boards.find((board) => board.board === activeDouyinTab) || boards[0];
  douyinBoardHost.innerHTML = "";
  douyinBoardHost.appendChild(renderBoard(activeBoard));

  [...douyinTabs.querySelectorAll(".tab-button")].forEach((button) => {
    button.addEventListener("click", () => {
      activeDouyinTab = button.dataset.board;
      renderDouyinTabs();
    });
  });
}

function renderOtherTabs() {
  if (!otherTabs || !otherBoardHost) return;
  const boards = OTHER_PLATFORM_ORDER.map((platform) => latestPayload?.boards?.find((item) => item.platform === platform)).filter(Boolean);

  if (!boards.length) {
    otherTabs.innerHTML = "";
    otherBoardHost.innerHTML = '<div class="board-empty">其他平台热搜暂时不可用</div>';
    return;
  }

  if (!boards.some((board) => board.platform === activeOtherPlatform)) {
    activeOtherPlatform = boards[0].platform;
  }

  otherTabs.innerHTML = boards
    .map(
      (board) => `<button class="tab-button ${board.platform === activeOtherPlatform ? "active" : ""}" data-platform="${board.platform}">
        ${escapeHtml(board.platformLabel)} <span>(${Math.min(board.items.length, board.displayLimit || board.items.length)})</span>
      </button>`,
    )
    .join("");

  const activeBoard = boards.find((board) => board.platform === activeOtherPlatform) || boards[0];
  otherBoardHost.innerHTML = "";
  otherBoardHost.appendChild(renderBoard(activeBoard));

  [...otherTabs.querySelectorAll(".tab-button")].forEach((button) => {
    button.addEventListener("click", () => {
      activeOtherPlatform = button.dataset.platform;
      renderOtherTabs();
    });
  });
}

function renderPlatformSections() {
  if (!douyinBoardHost) return;
  renderDouyinTabs();
  renderOtherTabs();
}

function createEmptyNode(text) {
  const wrapper = document.createElement("div");
  wrapper.className = "board-empty";
  wrapper.textContent = text;
  return wrapper;
}

function renderPage(payload) {
  latestPayload = payload;
  lastUpdated.textContent = payload.updatedAt ? formatDateTime(payload.updatedAt) : "暂无";
  if (payload.refreshing?.length) {
    lastUpdated.textContent += " · 后台刷新中";
  }
  currentCity.textContent = payload.cityName;
  historySince.textContent = payload.historyInfo?.collectedSince
    ? `历史已从 ${formatDateTime(payload.historyInfo.collectedSince)} 开始积累。`
    : "首次运行后开始积累历史。";

  renderCitySelect(payload.cityPresets || []);
  renderPlatformSections();
}

function buildClientSideSearchResult(query) {
  const tokens = buildSearchTokens(query);
  const boards = latestPayload?.boards || [];
  const matched = boards.flatMap((board) =>
    (board.items || [])
      .filter((item) => {
        const title = normalizeKeyword(item.title);
        return tokens.some((token) => title.includes(token));
      })
      .map((item) => ({
        title: item.title,
        sourceType: "live-fallback",
        firstSeen: board.updatedAt,
        lastSeen: board.updatedAt,
        bestRank: item.rank,
        bestSeenAt: board.updatedAt,
        appearanceCount: 1,
        bestUrl: item.searchUrl || item.url || buildDouyinSearchUrl(item.title),
        latestUrl: item.searchUrl || item.url || buildDouyinSearchUrl(item.title),
        boardMatches: [
          {
            platform: board.platform,
            platformLabel: board.platformLabel,
            board: board.board,
            boardLabel: board.board === "local" && board.cityName ? `${board.boardLabel} · ${board.cityName}` : board.boardLabel,
            cityName: board.cityName || null,
            bestRank: item.rank,
            latestRank: item.rank,
            url: item.searchUrl || item.url || buildDouyinSearchUrl(item.title),
            sourceType: "live-fallback",
            lastSeen: board.updatedAt,
          },
        ],
        recentSightings: [{ timestamp: board.updatedAt, rank: item.rank, hot: item.hot, hotText: item.hotText }],
      })),
  );

  const deduped = new Map();
  matched.forEach((item) => {
    const key = normalizeKeyword(item.title);
    const previous = deduped.get(key);
    if (!previous) {
      deduped.set(key, item);
      return;
    }

    previous.firstSeen = Math.min(previous.firstSeen || item.firstSeen, item.firstSeen);
    previous.lastSeen = Math.max(previous.lastSeen || item.lastSeen, item.lastSeen);
    if ((item.bestRank || 999) <= (previous.bestRank || 999)) {
      previous.bestSeenAt = item.bestSeenAt || previous.bestSeenAt || item.firstSeen;
      previous.bestUrl = item.bestUrl || previous.bestUrl || item.latestUrl;
    }
    previous.bestRank = Math.min(previous.bestRank || item.bestRank, item.bestRank);
    previous.appearanceCount += item.appearanceCount;
    previous.recentSightings = [...previous.recentSightings, ...item.recentSightings]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 8);
    previous.boardMatches.push(...item.boardMatches);
  });

  return {
    query,
    days: 15,
    total: deduped.size,
    tokens,
    items: [...deduped.values()]
      .sort(
        (a, b) =>
          (a.bestRank || 999) - (b.bestRank || 999) ||
          (b.lastSeen || 0) - (a.lastSeen || 0) ||
          (b.appearanceCount || 0) - (a.appearanceCount || 0),
      )
      .slice(0, 100),
    fallback: true,
  };
}

function renderSearchResults(payload) {
  const isFallback = payload.fallback;
  searchSummary.textContent = payload.query?.trim()
    ? `${isFallback ? "搜索接口临时不可用，已改用当前榜单兜底。" : "已按近 15 天历史最高排名优先展示。"} 找到 ${payload.total} 条与“${payload.query}”相关的记录。${
        payload.tokens?.length ? `匹配片段：${payload.tokens.slice(0, 6).join(" / ")}` : ""
      }`
    : "输入关键词即可查询。";

  if (!payload.items?.length) {
    searchResults.classList.add("empty");
    searchResults.textContent = payload.query?.trim() ? "没有找到相关结果。" : "暂无搜索结果";
    return;
  }

  searchResults.classList.remove("empty");
  searchResults.innerHTML = "";

  payload.items.forEach((item) => {
    const node = searchItemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".search-title").textContent = item.title;
    node.querySelector(".search-link").href = item.bestUrl || item.latestUrl || "#";

    const tags = (item.boardMatches || [])
      .sort((a, b) => (a.bestRank || 999) - (b.bestRank || 999) || (b.lastSeen || 0) - (a.lastSeen || 0))
      .map((match) => {
        const highest = `最高#${match.bestRank ?? "-"}`;
        const latest =
          match.latestRank && match.latestRank !== match.bestRank ? ` 最近#${match.latestRank}` : match.latestRank ? ` 最近#${match.latestRank}` : "";
        return `${match.platformLabel} ${match.boardLabel} ${highest}${latest}`;
      })
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");

    node.querySelector(".tag-row").innerHTML = tags;
    node.querySelector(".search-metrics").innerHTML = `
      <div class="metric">
        <span>首次发现</span>
        <strong>${formatDateTime(item.firstSeen)}</strong>
      </div>
      <div class="metric">
        <span>最近一次</span>
        <strong>${formatDateTime(item.lastSeen)}</strong>
      </div>
      <div class="metric">
        <span>最高时间</span>
        <strong>${formatDateTime(item.bestSeenAt)}</strong>
      </div>
      <div class="metric">
        <span>最好排名</span>
        <strong>#${item.bestRank ?? "-"}</strong>
      </div>
      <div class="metric">
        <span>出现次数</span>
        <strong>${item.appearanceCount ?? 0}</strong>
      </div>
    `;

    node.querySelector(".timeline").innerHTML = (item.recentSightings || [])
      .map(
        (point) => `
          <div class="timeline-item">
            <div>${formatDateTime(point.timestamp)}</div>
            <strong>排名 #${point.rank}</strong>
            <div>${escapeHtml(formatHot(point))}</div>
          </div>
        `,
      )
      .join("");

    searchResults.appendChild(node);
  });
}

async function loadBoards(force = false) {
  setLoading(true);
  try {
    const payload = await fetchJsonWithRetry([
      `/api/boards?cityCode=${currentCityCode}${force ? "&force=1" : ""}`,
      `/api/boards?cityCode=${DEFAULT_CITY_CODE}${force ? "&force=1" : ""}`,
    ]);
    renderPage(payload);
    const cityRefreshKeyPrefixes = [`boards:${currentCityCode}:init`, `boards:${currentCityCode}:force`, `boards:${currentCityCode}:soft`];
    const isCityRefreshing = (payload.refreshing || []).some((key) => cityRefreshKeyPrefixes.some((prefix) => key.startsWith(prefix)));
    if (cityRefreshTimer) {
      window.clearTimeout(cityRefreshTimer);
      cityRefreshTimer = null;
    }
    if (isCityRefreshing) {
      cityRefreshTimer = window.setTimeout(() => {
        loadBoards(false);
      }, 1200);
    }
  } catch (error) {
    lastUpdated.textContent = "加载失败";
    if (douyinBoardHost) {
      douyinBoardHost.innerHTML = "";
      douyinBoardHost.appendChild(createEmptyNode(`榜单拉取失败：${error.message || "未知错误"}`));
    }
    if (otherBoardHost) otherBoardHost.innerHTML = "";
  } finally {
    setLoading(false);
  }
}

async function runSearch(query) {
  if (!query.trim()) {
    searchSummary.textContent = "请输入要搜索的热点词。";
    searchResults.classList.add("empty");
    searchResults.textContent = "暂无搜索结果";
    return;
  }

  searchSummary.textContent = "正在查询近 15 日上榜记录...";
  searchResults.classList.add("empty");
  searchResults.textContent = "检索中...";

  try {
    const payload = await fetchJsonWithRetry([
      `/api/search?q=${encodeURIComponent(query)}&days=15&cityCode=${currentCityCode}`,
      `/api/search?q=${encodeURIComponent(query)}&days=15&cityCode=${DEFAULT_CITY_CODE}`,
      `/api/search?q=${encodeURIComponent(query)}&days=15`,
    ]);
    renderSearchResults(payload);
  } catch {
    renderSearchResults(buildClientSideSearchResult(query));
  }
}

refreshButton.addEventListener("click", () => {
  searchSummary.textContent = "已触发后台刷新，页面会先显示缓存结果，再自动切到新数据。";
  loadBoards(true);
});

ensureLayout();

citySelect?.addEventListener("change", () => {
  currentCityCode = citySelect.value;
  if (activeDouyinTab !== "local") activeDouyinTab = "local";
  loadBoards(false);
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(searchInput.value);
});

loadBoards(true);
autoRefreshTimer = window.setInterval(() => {
  loadBoards(false);
}, 60 * 1000);

window.addEventListener("beforeunload", () => {
  if (autoRefreshTimer) window.clearInterval(autoRefreshTimer);
  if (cityRefreshTimer) window.clearTimeout(cityRefreshTimer);
});
