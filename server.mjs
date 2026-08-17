import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "hot-monitor-store.json");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const CACHE_TTL_MS = 2 * 60 * 1000;
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const HISTORY_RETENTION_MS = 15 * 24 * 60 * 60 * 1000;
const HISTORY_SAMPLE_INTERVAL_MS = Math.max(60 * 1000, Math.min(AUTO_REFRESH_MS, CACHE_TTL_MS));
const MAX_SIGHTINGS_PER_ENTRY = Math.ceil(HISTORY_RETENTION_MS / HISTORY_SAMPLE_INTERVAL_MS) + 24;

const CITY_PRESETS = [
  { code: "310000", name: "上海" },
  { code: "110000", name: "北京" },
  { code: "120000", name: "天津" },
  { code: "500000", name: "重庆" },
  { code: "440100", name: "广州" },
  { code: "440300", name: "深圳" },
  { code: "330100", name: "杭州" },
  { code: "320100", name: "南京" },
  { code: "320500", name: "苏州" },
  { code: "510100", name: "成都" },
  { code: "420100", name: "武汉" },
  { code: "610100", name: "西安" },
  { code: "370100", name: "济南" },
  { code: "370200", name: "青岛" },
  { code: "210100", name: "沈阳" },
  { code: "210200", name: "大连" },
  { code: "230100", name: "哈尔滨" },
  { code: "220100", name: "长春" },
  { code: "350100", name: "福州" },
  { code: "350200", name: "厦门" },
  { code: "330200", name: "宁波" },
  { code: "410100", name: "郑州" },
  { code: "430100", name: "长沙" },
  { code: "530100", name: "昆明" },
  { code: "450100", name: "南宁" },
  { code: "360100", name: "南昌" },
  { code: "340100", name: "合肥" },
  { code: "650100", name: "乌鲁木齐" },
  { code: "460100", name: "海口" },
  { code: "340100", name: "合肥" },
];

const DEFAULT_CITY_CODE = "310000";

const BOARD_META = {
  "douyin-total": { platform: "douyin", platformLabel: "抖音", board: "total", boardLabel: "热点总榜" },
  "douyin-local": { platform: "douyin", platformLabel: "抖音", board: "local", boardLabel: "同城榜" },
  "douyin-entertainment": { platform: "douyin", platformLabel: "抖音", board: "entertainment", boardLabel: "娱乐榜" },
  "douyin-seeding": { platform: "douyin", platformLabel: "抖音", board: "seeding", boardLabel: "种草榜" },
  "douyin-heating": { platform: "douyin", platformLabel: "抖音", board: "heating", boardLabel: "加热榜" },
  "douyin-challenge": { platform: "douyin", platformLabel: "抖音", board: "challenge", boardLabel: "挑战榜" },
  "douyin-rising": { platform: "douyin", platformLabel: "抖音", board: "rising", boardLabel: "上升热点" },
  "weibo-hot": { platform: "weibo", platformLabel: "微博", board: "hot", boardLabel: "热搜榜" },
  "xiaohongshu-hot": { platform: "xiaohongshu", platformLabel: "小红书", board: "hot", boardLabel: "热榜" },
  "kuaishou-hot": { platform: "kuaishou", platformLabel: "快手", board: "hot", boardLabel: "网页热榜" },
  "baidu-hot": { platform: "baidu", platformLabel: "百度", board: "hot", boardLabel: "热搜榜" },
};

const state = {
  snapshots: {},
  historyIndex: {},
  meta: {
    lastGeneralRefreshAt: 0,
  },
};

let saveTimer = null;
const refreshInFlight = new Map();

function normalizeKeyword(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, "");
}

function buildSearchTokens(value = "") {
  const normalized = normalizeKeyword(value);
  if (!normalized) return [];

  const tokenSet = new Set([normalized]);
  const parts = String(value)
    .split(/[\s,，、|/]+/u)
    .map((item) => normalizeKeyword(item))
    .filter(Boolean);

  parts.forEach((item) => tokenSet.add(item));

  if (normalized.length >= 2) {
    for (let size = Math.min(4, normalized.length); size >= 2; size -= 1) {
      for (let index = 0; index <= normalized.length - size; index += 1) {
        tokenSet.add(normalized.slice(index, index + size));
      }
    }
  }

  return [...tokenSet].sort((a, b) => b.length - a.length);
}

function cityNameFromCode(cityCode) {
  return CITY_PRESETS.find((item) => item.code === cityCode)?.name || `城市 ${cityCode}`;
}

function sanitizeCityCode(cityCode) {
  const normalized = String(cityCode || "").trim();
  return CITY_PRESETS.some((item) => item.code === normalized) ? normalized : DEFAULT_CITY_CODE;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return null;
  const cleaned = String(value).replace(/[,\s]/g, "").replace(/亿$/u, "00000000").replace(/w$/iu, "0000");
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatRelativeMinutes(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistState().catch((error) => {
      console.error("保存数据失败:", error);
    });
  }, 300);
}

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_FILE);
  } catch {
    await fs.writeFile(
      STORE_FILE,
      JSON.stringify(
        {
          snapshots: {},
          historyIndex: {},
          meta: {
            lastGeneralRefreshAt: 0,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}

async function loadState() {
  await ensureStore();
  const content = await fs.readFile(STORE_FILE, "utf8");
  const parsed = JSON.parse(content || "{}");
  state.snapshots = parsed.snapshots || {};
  state.historyIndex = parsed.historyIndex || {};
  state.meta = parsed.meta || { lastGeneralRefreshAt: 0 };
  pruneHistory();
}

async function persistState() {
  await ensureStore();
  await fs.writeFile(
    STORE_FILE,
    JSON.stringify(
      {
        snapshots: state.snapshots,
        historyIndex: state.historyIndex,
        meta: state.meta,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function pruneHistory() {
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  for (const [key, entry] of Object.entries(state.historyIndex)) {
    entry.sightings = (entry.sightings || []).filter((item) => item.timestamp >= cutoff);
    if (entry.sightings.length) {
      entry.sightings.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      entry.firstSeen = entry.sightings[0]?.timestamp || entry.firstSeen;
      entry.lastSeen = entry.sightings.at(-1)?.timestamp || entry.lastSeen;
      entry.latestRank = entry.sightings.at(-1)?.rank || entry.latestRank;
      entry.latestHot = entry.sightings.at(-1)?.hot ?? entry.latestHot ?? null;

      const bestSighting = entry.sightings.reduce((best, item) => {
        if (!best) return item;
        const currentRank = item.rank ?? 999;
        const bestRank = best.rank ?? 999;
        if (currentRank < bestRank) return item;
        if (currentRank === bestRank && (item.timestamp || 0) > (best.timestamp || 0)) return item;
        return best;
      }, null);

      if (bestSighting) {
        entry.bestRank = bestSighting.rank ?? entry.bestRank;
        entry.bestSeenAt = bestSighting.timestamp || entry.bestSeenAt || entry.firstSeen;
        entry.bestHot = bestSighting.hot ?? entry.bestHot ?? null;
      }
    }

    entry.bestUrl = entry.bestUrl || entry.latestUrl || entry.searchUrl || "";
    if (!entry.lastSeen || entry.lastSeen < cutoff) {
      delete state.historyIndex[key];
    }
  }
}

function updateHistoryIndex(snapshot) {
  const now = snapshot.updatedAt;
  snapshot.items.forEach((item, index) => {
    const rank = item.rank ?? index + 1;
    const entryKey = [
      snapshot.platform,
      snapshot.board,
      snapshot.cityCode || "",
      normalizeKeyword(item.title),
    ].join("::");

    const previous = state.historyIndex[entryKey] || {
      key: entryKey,
      title: item.title,
      platform: snapshot.platform,
      platformLabel: snapshot.platformLabel,
      board: snapshot.board,
      boardLabel: snapshot.boardLabel,
      cityCode: snapshot.cityCode || null,
      cityName: snapshot.cityName || null,
      firstSeen: now,
      lastSeen: now,
      appearanceCount: 0,
      bestRank: rank,
      bestSeenAt: now,
      bestHot: item.hot ?? null,
      latestRank: rank,
      latestHot: item.hot ?? null,
      searchUrl: item.searchUrl || item.url || item.mobileUrl || "",
      bestUrl: item.searchUrl || item.url || item.mobileUrl || "",
      latestUrl: item.url || item.mobileUrl || "",
      sightings: [],
    };

    previous.appearanceCount += 1;
    if ((previous.bestRank || 999) >= rank) {
      previous.bestRank = rank;
      previous.bestSeenAt = now;
      previous.bestHot = item.hot ?? previous.bestHot ?? null;
      previous.bestUrl = item.searchUrl || item.url || item.mobileUrl || previous.bestUrl || previous.latestUrl || "";
    }
    previous.latestRank = rank;
    previous.latestHot = item.hot ?? previous.latestHot ?? null;
    previous.searchUrl = item.searchUrl || item.url || item.mobileUrl || previous.searchUrl || "";
    previous.bestUrl = previous.bestUrl || previous.searchUrl || previous.latestUrl || "";
    previous.latestUrl = item.url || item.mobileUrl || previous.latestUrl || "";
    previous.lastSeen = now;
    if (!previous.firstSeen) previous.firstSeen = now;

    const lastSighting = previous.sightings.at(-1);
    const shouldAppend =
      !lastSighting ||
      lastSighting.rank !== rank ||
      lastSighting.hot !== (item.hot ?? null) ||
      now - lastSighting.timestamp >= HISTORY_SAMPLE_INTERVAL_MS;

    if (shouldAppend) {
      previous.sightings.push({
        timestamp: now,
        rank,
        hot: item.hot ?? null,
      });
      if (previous.sightings.length > MAX_SIGHTINGS_PER_ENTRY) {
        previous.sightings = previous.sightings.slice(-MAX_SIGHTINGS_PER_ENTRY);
      }
    }

    state.historyIndex[entryKey] = previous;
  });
}

function saveSnapshot(snapshotKey, snapshot) {
  state.snapshots[snapshotKey] = snapshot;
  updateHistoryIndex(snapshot);
  pruneHistory();
  scheduleSave();
}

function hasAnySnapshot() {
  return Object.keys(state.snapshots).length > 0;
}

function hasLocalSnapshot(cityCode) {
  return Boolean(state.snapshots[`douyin-local-${cityCode}`]);
}

function buildPendingLocalSnapshot(cityCode) {
  const existingLocal =
    Object.values(state.snapshots).find((item) => item.platform === "douyin" && item.board === "local" && item.items?.length) || null;

  return {
    ...BOARD_META["douyin-local"],
    updatedAt: existingLocal?.updatedAt || Date.now(),
    cityCode,
    cityName: cityNameFromCode(cityCode),
    displayLimit: 50,
    note: "正在后台加载该城市同城榜，请稍后自动更新。",
    items: existingLocal?.cityCode === cityCode ? existingLocal.items : [],
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function safeFetchBoard(label, fetcher) {
  try {
    return await fetcher();
  } catch (error) {
    console.error(`${label} 拉取失败:`, error);
    return null;
  }
}

function parseJsonWithTrailingGarbage(text = "") {
  const lastBrace = text.lastIndexOf("}");
  const safeText = lastBrace >= 0 ? text.slice(0, lastBrace + 1) : text;
  return JSON.parse(safeText);
}

function mapDouyinItem(item, index) {
  const title = String(item.word || `抖音热点 ${index + 1}`).replace(/\s+/g, " ").trim();
  const hotUrl = item.sentence_id ? `https://www.douyin.com/hot/${item.sentence_id}` : "";
  const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(title)}`;
  return {
    id: item.sentence_id || item.group_id || `douyin-${index + 1}`,
    rank: item.position || index + 1,
    title,
    hot: item.hot_value ?? item.view_count ?? 0,
    tags: [item.sentence_tag, item.word_type].filter(Boolean).map(String),
    url: searchUrl,
    mobileUrl: searchUrl,
    detailUrl: hotUrl || "",
    searchUrl,
    timestamp: item.event_time ? item.event_time * 1000 : Date.now(),
  };
}

function cleanDouyinList(list = []) {
  return list
    .filter((item) => item?.word)
    .filter((item) => item.hot_value || item.event_time || item.position || item.view_count)
    .map(mapDouyinItem);
}

function buildDouyinHeatingList(totalRaw) {
  const tagged = cleanDouyinList(
    (totalRaw.data?.word_list || []).filter((item) => Array.isArray(item.word_sub_board) && item.word_sub_board.length),
  );

  return tagged.slice(0, 50).map((item, index) => ({
    ...item,
    rank: index + 1,
    tags: [...(item.tags || []), "专题加热"],
  }));
}

function buildDouyinHistoryRisingCandidates(excludeKeys = new Set()) {
  const now = Date.now();
  return Object.values(state.historyIndex)
    .filter((entry) => entry.platform === "douyin")
    .filter((entry) => entry.board !== "rising")
    .filter((entry) => entry.lastSeen && now - entry.lastSeen <= 3 * 24 * 60 * 60 * 1000)
    .filter((entry) => !excludeKeys.has(normalizeKeyword(entry.title)))
    .sort((a, b) => {
      const freshness = (b.lastSeen || 0) - (a.lastSeen || 0);
      if (freshness) return freshness;
      return (a.appearanceCount || 0) - (b.appearanceCount || 0);
    })
    .map((entry) => ({
      id: entry.key,
      rank: entry.latestRank || entry.bestRank || 0,
      title: entry.title,
      hot: entry.latestHot ?? null,
      url: entry.latestUrl || `https://www.douyin.com/search/${encodeURIComponent(entry.title)}`,
      mobileUrl: `https://www.douyin.com/search/${encodeURIComponent(entry.title)}`,
      detailUrl: entry.latestUrl || "",
      searchUrl: `https://www.douyin.com/search/${encodeURIComponent(entry.title)}`,
      timestamp: entry.lastSeen,
      tags: ["历史补充"],
    }));
}

function buildDouyinRisingList(totalRaw, otherBoards = []) {
  const excludeKeys = new Set(
    otherBoards.flatMap((board) => (board || []).map((item) => normalizeKeyword(item.title))).filter(Boolean),
  );

  return cleanDouyinList(totalRaw.data?.trending_list || [])
    .filter((item) => item.detailUrl)
    .filter((item) => !excludeKeys.has(normalizeKeyword(item.title)))
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      tags: [...(item.tags || []), "官方上升"],
    }));
}

function queueRefresh(refreshKey, refreshFn) {
  if (refreshInFlight.has(refreshKey)) return refreshInFlight.get(refreshKey);

  const task = refreshFn()
    .catch((error) => {
      console.error(`后台刷新失败 (${refreshKey}):`, error);
    })
    .finally(() => {
      refreshInFlight.delete(refreshKey);
    });

  refreshInFlight.set(refreshKey, task);
  return task;
}

async function fetchDouyinBundle(cityCode) {
  const endpoint = "https://www.douyin.com/aweme/v1/web/hot/search/list/";
  const common = new URLSearchParams({
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    detail_list: "1",
    source: "6",
    version_code: "170400",
    version_name: "17.4.0",
  });

  const headers = {
    Referer: "https://www.douyin.com/discover",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  };

  const request = async (boardType, boardSubType = "") => {
    const params = new URLSearchParams(common);
    params.set("board_type", String(boardType));
    params.set("board_sub_type", String(boardSubType));
    return fetchJson(`${endpoint}?${params.toString()}`, { headers });
  };

  const [totalRaw, entertainmentRaw, seedingRaw, challengeRaw, localRaw] = await Promise.all([
    request(0, ""),
    request(2, "2"),
    request(2, "seeding"),
    request(2, "hotspot_challenge"),
    request(1, cityCode),
  ]);

  return {
    total: cleanDouyinList(totalRaw.data?.word_list || []),
    heating: buildDouyinHeatingList(totalRaw),
    entertainment: cleanDouyinList(entertainmentRaw.data?.word_list || []),
    seeding: cleanDouyinList(seedingRaw.data?.word_list || []),
    challenge: cleanDouyinList(challengeRaw.data?.word_list || []),
    local: cleanDouyinList(localRaw.data?.word_list || []),
    rising: buildDouyinRisingList(totalRaw, [
      cleanDouyinList(totalRaw.data?.word_list || []),
      cleanDouyinList(entertainmentRaw.data?.word_list || []),
      cleanDouyinList(seedingRaw.data?.word_list || []),
      cleanDouyinList(challengeRaw.data?.word_list || []),
      cleanDouyinList(localRaw.data?.word_list || []),
      buildDouyinHeatingList(totalRaw),
    ]),
  };
}

async function fetchWeiboBoard() {
  const raw = await fetchJson("https://weibo.com/ajax/side/hotSearch", {
    headers: {
      Referer: "https://weibo.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    },
  });

  return (raw.data?.realtime || []).map((item, index) => {
    const title = item.word || item.word_scheme || `微博热搜 ${index + 1}`;
    const searchUrl = `https://s.weibo.com/weibo?q=${encodeURIComponent(title)}`;
    return {
      id: item.mid || item.word_scheme || `weibo-${index + 1}`,
      rank: index + 1,
      title,
      hot: null,
      url: searchUrl,
      mobileUrl: searchUrl,
      searchUrl,
      timestamp: item.onboard_time ? item.onboard_time * 1000 : Date.now(),
    };
  });
}

async function fetchXiaohongshuBoard() {
  const raw = await fetchJson("https://60s.viki.moe/v2/rednote");
  return (raw.data || []).map((item, index) => {
    const searchUrl = item.link || "https://www.xiaohongshu.com/explore";
    return {
      id: `${item.rank || index + 1}-${item.title}`,
      rank: item.rank || index + 1,
      title: item.title,
      hot: toNumber(item.score) ?? item.score ?? null,
      hotText: item.score || "",
      tags: [item.word_type].filter(Boolean),
      url: searchUrl,
      mobileUrl: searchUrl,
      searchUrl,
      timestamp: Date.now(),
    };
  });
}

async function fetchKuaishouBoard() {
  const html = await fetchText("https://www.kuaishou.com/?isHome=1", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    },
  });

  const prefix = "window.__APOLLO_STATE__=";
  const start = html.indexOf(prefix);
  if (start === -1) throw new Error("快手页面结构变更，未找到热榜数据");

  const scriptSlice = html.slice(start + prefix.length);
  const sentinelA = scriptSlice.indexOf(";(function(");
  const sentinelB = scriptSlice.indexOf("</script>");
  const cutIndex = sentinelA !== -1 && sentinelB !== -1 ? Math.min(sentinelA, sentinelB) : Math.max(sentinelA, sentinelB);
  if (cutIndex === -1) throw new Error("快手页面结构变更，未找到热榜结束标记");

  const raw = scriptSlice.slice(0, cutIndex).trim().replace(/;$/, "");
  const jsonObject = parseJsonWithTrailingGarbage(raw).defaultClient || {};
  const allItems =
    jsonObject['$ROOT_QUERY.visionHotRank({"page":"home"})']?.items ||
    jsonObject['$ROOT_QUERY.visionHotRank({"page":"home","platform":"web"})']?.items ||
    [];

  return allItems
    .map((item, index) => {
      const hotItem = jsonObject[item.id];
      if (!hotItem) return null;
      const photoId = hotItem.photoIds?.json?.[0] || "";
      const title = hotItem.name || `快手热搜 ${index + 1}`;
      const searchUrl = `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(title)}`;
      return {
        id: hotItem.id || `kuaishou-${index + 1}`,
        rank: index + 1,
        title,
        hot: toNumber(hotItem.hotValue) ?? hotItem.hotValue ?? null,
        url: searchUrl,
        mobileUrl: searchUrl,
        detailUrl: photoId ? `https://www.kuaishou.com/short-video/${photoId}` : "",
        searchUrl,
        timestamp: Date.now(),
      };
    })
    .filter(Boolean)
    .slice(0, 50);
}

async function fetchBaiduBoard() {
  const html = await fetchText("https://top.baidu.com/board?tab=realtime", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    },
  });

  const matchResult = html.match(/<!--s-data:(.*?)-->/s);
  if (!matchResult) throw new Error("百度热搜页面结构变更，未找到数据块");

  let jsonObject = [];
  try {
    const sData = JSON.parse(matchResult[1]);
    const cardContent = sData.data?.cards?.[0]?.content ?? sData.cards?.[0]?.content;
    jsonObject =
      Array.isArray(cardContent) && Array.isArray(cardContent[0]?.content) ? cardContent[0].content : cardContent || [];
  } catch {
    jsonObject = [];
  }

  return jsonObject.slice(0, 50).map((item, index) => {
    const title = item.word ?? item.title ?? `百度热搜 ${index + 1}`;
    const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(item.query ?? title)}`;
    return {
      id: item.index ?? index + 1,
      rank: index + 1,
      title,
      hot: parseInt((item.hotScore ?? item.hotTag ?? "0").toString(), 10) || 0,
      url: searchUrl,
      mobileUrl: searchUrl,
      detailUrl: item.rawUrl ?? item.url ?? "",
      searchUrl,
      timestamp: Date.now(),
    };
  });
}

async function refreshBoards({ cityCode = DEFAULT_CITY_CODE, force = false } = {}) {
  cityCode = sanitizeCityCode(cityCode);
  const now = Date.now();
  const generalStale = now - (state.meta.lastGeneralRefreshAt || 0) > CACHE_TTL_MS;
  const localSnapshotKey = `douyin-local-${cityCode}`;
  const localUpdatedAt = state.snapshots[localSnapshotKey]?.updatedAt || 0;
  const localStale = now - localUpdatedAt > CACHE_TTL_MS;

  if (!force && !generalStale && !localStale) {
    return;
  }

  try {
    const [douyin, weibo, xiaohongshu, kuaishou, baidu] = await Promise.all([
      force || generalStale || localStale ? safeFetchBoard("抖音", () => fetchDouyinBundle(cityCode)) : Promise.resolve(null),
      force || generalStale ? safeFetchBoard("微博", fetchWeiboBoard) : Promise.resolve(null),
      force || generalStale ? safeFetchBoard("小红书", fetchXiaohongshuBoard) : Promise.resolve(null),
      force || generalStale ? safeFetchBoard("快手", fetchKuaishouBoard) : Promise.resolve(null),
      force || generalStale ? safeFetchBoard("百度", fetchBaiduBoard) : Promise.resolve(null),
    ]);

    if (douyin) {
      const cityName = cityNameFromCode(cityCode);
      saveSnapshot("douyin-total", {
        ...BOARD_META["douyin-total"],
        updatedAt: Date.now(),
        displayLimit: 50,
        items: douyin.total,
      });
      saveSnapshot("douyin-entertainment", {
        ...BOARD_META["douyin-entertainment"],
        updatedAt: Date.now(),
        displayLimit: 50,
        items: douyin.entertainment,
      });
      saveSnapshot("douyin-seeding", {
        ...BOARD_META["douyin-seeding"],
        updatedAt: Date.now(),
        displayLimit: 50,
        items: douyin.seeding,
      });
      saveSnapshot("douyin-heating", {
        ...BOARD_META["douyin-heating"],
        updatedAt: Date.now(),
        displayLimit: 50,
        items: douyin.heating,
      });
      saveSnapshot("douyin-challenge", {
        ...BOARD_META["douyin-challenge"],
        updatedAt: Date.now(),
        displayLimit: 50,
        items: douyin.challenge,
      });
      saveSnapshot("douyin-rising", {
        ...BOARD_META["douyin-rising"],
        updatedAt: Date.now(),
        displayLimit: 50,
        note: "当前仅展示公开网页源能拿到的官方上升词，并已排除与其他抖音榜单重复的词。",
        items: douyin.rising,
      });
      saveSnapshot(localSnapshotKey, {
        ...BOARD_META["douyin-local"],
        updatedAt: Date.now(),
        displayLimit: 50,
        cityCode,
        cityName,
        items: douyin.local,
      });
    }

    if (weibo) {
      saveSnapshot("weibo-hot", {
        ...BOARD_META["weibo-hot"],
        updatedAt: Date.now(),
        displayLimit: 50,
        items: weibo,
      });
    }

    if (xiaohongshu) {
      saveSnapshot("xiaohongshu-hot", {
        ...BOARD_META["xiaohongshu-hot"],
        updatedAt: Date.now(),
        displayLimit: 50,
        items: xiaohongshu,
      });
    }

    if (kuaishou) {
      saveSnapshot("kuaishou-hot", {
        ...BOARD_META["kuaishou-hot"],
        updatedAt: Date.now(),
        displayLimit: 50,
        note: "当前展示的是快手网页公开热榜，可能与 App 实时热榜存在差异。",
        items: kuaishou,
      });
    }

    if (baidu) {
      saveSnapshot("baidu-hot", {
        ...BOARD_META["baidu-hot"],
        updatedAt: Date.now(),
        displayLimit: 50,
        items: baidu,
      });
    }

    if (force || generalStale) {
      state.meta.lastGeneralRefreshAt = Date.now();
      scheduleSave();
    }
  } catch (error) {
    console.error("刷新榜单失败:", error);
    throw error;
  }
}

function buildBoardPayload(cityCode) {
  cityCode = sanitizeCityCode(cityCode);
  const localKey = `douyin-local-${cityCode}`;
  const localSnapshot = state.snapshots[localKey] || buildPendingLocalSnapshot(cityCode);
  const snapshots = [
    state.snapshots["douyin-total"],
    localSnapshot,
    state.snapshots["douyin-entertainment"],
    state.snapshots["douyin-seeding"],
    state.snapshots["douyin-heating"],
    state.snapshots["douyin-challenge"],
    state.snapshots["douyin-rising"],
    state.snapshots["weibo-hot"],
    state.snapshots["xiaohongshu-hot"],
    state.snapshots["kuaishou-hot"],
    state.snapshots["baidu-hot"],
  ].filter(Boolean);

  const updatedAt = snapshots
    .map((item) => item.updatedAt || 0)
    .reduce((max, value) => (value > max ? value : max), 0);

  return {
    updatedAt,
    cityCode,
    cityName: cityNameFromCode(cityCode),
    boards: snapshots,
    cityPresets: CITY_PRESETS,
    refreshing: [...refreshInFlight.keys()],
    historyInfo: {
      retentionDays: 15,
      collectedSince:
        Object.values(state.historyIndex)
          .map((entry) => entry.firstSeen || 0)
          .filter(Boolean)
          .sort((a, b) => a - b)[0] || null,
    },
  };
}

function buildLiveSearchEntries() {
  return Object.values(state.snapshots).flatMap((snapshot) =>
    (snapshot.items || []).map((item, index) => ({
      key: `${snapshot.platform}::${snapshot.board}::live::${normalizeKeyword(item.title)}`,
      title: item.title,
      platform: snapshot.platform,
      platformLabel: snapshot.platformLabel,
      board: snapshot.board,
      boardLabel: snapshot.boardLabel,
      cityCode: snapshot.cityCode || null,
      cityName: snapshot.cityName || null,
      firstSeen: snapshot.updatedAt,
      lastSeen: snapshot.updatedAt,
      appearanceCount: 1,
      bestRank: item.rank ?? index + 1,
      bestSeenAt: snapshot.updatedAt,
      bestHot: item.hot ?? null,
      latestRank: item.rank ?? index + 1,
      latestHot: item.hot ?? null,
      bestUrl: item.searchUrl || item.url || item.mobileUrl || "",
      latestUrl: item.url || item.mobileUrl || "",
      searchUrl: item.searchUrl || item.url || item.mobileUrl || "",
      sightings: [
        {
          timestamp: snapshot.updatedAt,
          rank: item.rank ?? index + 1,
          hot: item.hot ?? null,
        },
      ],
      sourceType: "live",
    })),
  );
}

function scoreSearchEntry(entry, tokens) {
  const titleNormalized = normalizeKeyword(entry.title);
  let score = 0;

  if (!tokens.length) score += entry.appearanceCount || 1;

  tokens.forEach((token, index) => {
    if (!token) return;
    const weight = Math.max(30, 180 - index * 20);
    if (titleNormalized === token) score += weight + 320;
    else if (titleNormalized.startsWith(token)) score += weight + 180;
    else if (titleNormalized.includes(token)) score += weight + 100;
  });

  score += Math.max(0, 120 - Math.min(entry.bestRank || 120, 120));
  score += Math.min(entry.appearanceCount || 0, 80);
  if (entry.sourceType === "live") score += 40;
  return score;
}

function aggregateSearchResults(entries, tokens) {
  const grouped = new Map();

  entries.forEach((entry) => {
    const key = normalizeKeyword(entry.title);
    const previous = grouped.get(key);
    const boardLabel = entry.board === "local" && entry.cityName ? `${entry.boardLabel} · ${entry.cityName}` : entry.boardLabel;
    const boardMatch = {
      platform: entry.platform,
      platformLabel: entry.platformLabel,
      board: entry.board,
      boardLabel,
      cityName: entry.cityName || null,
      bestRank: entry.bestRank ?? entry.latestRank ?? null,
      latestRank: entry.latestRank ?? entry.bestRank ?? null,
      url: entry.searchUrl || entry.latestUrl || "",
      sourceType: entry.sourceType,
      lastSeen: entry.lastSeen || null,
    };

    if (!previous) {
      grouped.set(key, {
        title: entry.title,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        bestRank: entry.bestRank,
        bestSeenAt: entry.bestSeenAt || entry.firstSeen || null,
        appearanceCount: entry.appearanceCount || 0,
        bestUrl: entry.bestUrl || entry.searchUrl || entry.latestUrl || "",
        latestUrl: entry.searchUrl || entry.latestUrl || "",
        recentSightings: (entry.sightings || []).slice(-8).reverse(),
        sourceType: entry.sourceType,
        boardMatches: [boardMatch],
        score: scoreSearchEntry(entry, tokens),
      });
      return;
    }

    previous.firstSeen = Math.min(previous.firstSeen || entry.firstSeen || Date.now(), entry.firstSeen || Date.now());
    previous.lastSeen = Math.max(previous.lastSeen || 0, entry.lastSeen || 0);
    previous.bestRank = Math.min(previous.bestRank || 999, entry.bestRank || 999);
    previous.appearanceCount += entry.appearanceCount || 0;
    previous.score += scoreSearchEntry(entry, tokens);
    if ((entry.bestRank || 999) <= (previous.bestRank || 999)) {
      previous.bestSeenAt = entry.bestSeenAt || previous.bestSeenAt || entry.firstSeen || previous.firstSeen || null;
      previous.bestUrl = entry.bestUrl || entry.searchUrl || entry.latestUrl || previous.bestUrl || previous.latestUrl || "";
    }
    if ((entry.lastSeen || 0) >= (previous.lastSeen || 0)) {
      previous.latestUrl = entry.searchUrl || entry.latestUrl || previous.latestUrl;
    }

    const existing = previous.boardMatches.some(
      (item) => item.platform === boardMatch.platform && item.boardLabel === boardMatch.boardLabel,
    );
    if (!existing) previous.boardMatches.push(boardMatch);

    previous.recentSightings = [...previous.recentSightings, ...(entry.sightings || []).slice(-4)]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 8);
  });

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      boardMatches: item.boardMatches.sort(
        (a, b) => (a.bestRank || 999) - (b.bestRank || 999) || (b.lastSeen || 0) - (a.lastSeen || 0),
      ),
      recentSightings: item.recentSightings.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
    }))
    .sort(
      (a, b) =>
        (a.bestRank || 999) - (b.bestRank || 999) ||
        (b.lastSeen || 0) - (a.lastSeen || 0) ||
        (b.appearanceCount || 0) - (a.appearanceCount || 0) ||
        b.score - a.score,
    )
    .slice(0, 200);
}

function searchHistory(query, days = 15) {
  const tokens = buildSearchTokens(query);
  const cutoff = Date.now() - Math.min(Math.max(Number(days) || 15, 1), 15) * 24 * 60 * 60 * 1000;
  const liveEntries = buildLiveSearchEntries();
  const mergedEntries = new Map();

  [...Object.values(state.historyIndex), ...liveEntries].forEach((entry) => {
    const dedupeKey = [
      entry.platform,
      entry.board,
      entry.cityCode || "",
      normalizeKeyword(entry.title),
    ].join("::");
    const previous = mergedEntries.get(dedupeKey);
    if (!previous || (previous.sourceType === "live" && entry.sourceType !== "live")) {
      mergedEntries.set(dedupeKey, entry);
    }
  });

  const matchedEntries = [...mergedEntries.values()]
    .filter((entry) => entry.lastSeen >= cutoff)
    .filter((entry) => {
      if (!tokens.length) return true;
      const titleNormalized = normalizeKeyword(entry.title);
      return tokens.some((token) => titleNormalized.includes(token));
    })
    .map((entry) => ({
      ...entry,
      recentSightings: (entry.sightings || []).slice(-8).reverse(),
      score: scoreSearchEntry(entry, tokens),
    }));

  const results = aggregateSearchResults(matchedEntries, tokens);

  return {
    query,
    days,
    tokens,
    total: results.length,
    items: results,
  };
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      }[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = requestUrl.pathname;

    if (pathname === "/api/boards") {
      const cityCode = sanitizeCityCode(requestUrl.searchParams.get("cityCode") || DEFAULT_CITY_CODE);
      const force = requestUrl.searchParams.get("force") === "1";
      const needsInitialLoad = !hasAnySnapshot() || !hasLocalSnapshot(cityCode);

      if (needsInitialLoad && !hasAnySnapshot()) {
        await refreshBoards({ cityCode, force: true });
      } else if (needsInitialLoad) {
        queueRefresh(`boards:${cityCode}:init`, () => refreshBoards({ cityCode, force: true }));
      } else if (force) {
        queueRefresh(`boards:${cityCode}:force`, () => refreshBoards({ cityCode, force: true }));
      } else {
        queueRefresh(`boards:${cityCode}:soft`, () => refreshBoards({ cityCode, force: false }));
      }

      json(res, 200, buildBoardPayload(cityCode));
      return;
    }

    if (pathname === "/api/search") {
      const cityCode = sanitizeCityCode(requestUrl.searchParams.get("cityCode") || DEFAULT_CITY_CODE);
      if (!hasAnySnapshot()) {
        try {
          await refreshBoards({ cityCode, force: true });
        } catch (error) {
          console.error("搜索首次预热失败，改用本地缓存继续搜索:", error);
        }
      } else {
        queueRefresh(`search:${cityCode}:soft`, () => refreshBoards({ cityCode, force: false }));
      }
      const query = requestUrl.searchParams.get("q") || "";
      const days = Number(requestUrl.searchParams.get("days") || "15");
      json(res, 200, searchHistory(query, days));
      return;
    }

    if (pathname === "/api/status") {
      json(res, 200, {
        ok: true,
        lastGeneralRefreshAt: state.meta.lastGeneralRefreshAt || null,
        snapshots: Object.keys(state.snapshots).length,
        indexedTerms: Object.keys(state.historyIndex).length,
      });
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    console.error("请求处理失败:", error);
    json(res, 500, {
      ok: false,
      message: error instanceof Error ? error.message : "服务异常",
    });
  }
});

await loadState();

refreshBoards({ cityCode: "310000", force: true }).catch((error) => {
  console.error("启动预热失败:", error);
});

setInterval(() => {
  refreshBoards({ cityCode: "310000", force: true }).catch((error) => {
    console.error("定时刷新失败:", error);
  });
}, AUTO_REFRESH_MS);

server.listen(PORT, HOST, () => {
  console.log(`热点监控已启动: http://${HOST}:${PORT}`);
  console.log(`自动刷新周期: ${formatRelativeMinutes(AUTO_REFRESH_MS)}`);
});
