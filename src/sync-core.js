/*
 * 日序 · 同步核心
 *
 * 只做「本地数据 <-> 云端条目」的纯计算：取条目、算指纹、找差异、合并远端。
 * 不依赖 Electron、不联网，便于单测。
 *
 * 约定：
 * - 每条可同步数据用 `kind:id` 作键（event / source / inbox / settings）。
 * - 是否「改过」只看内容指纹，和状态文件里上次同步的指纹比。
 * - 本机不保存 per-item 的 updatedAt，时间戳只记在同步状态文件里，
 *   这样渲染层 normalizeData 重建对象时不会把时间戳弄丢。
 */
'use strict';

const crypto = require('crypto');

const ITEM_KINDS = ['event', 'source', 'inbox', 'template', 'series'];
const SETTINGS_KEY = 'settings:main';
const TOMBSTONE_DAYS = 90;

function nowISO() {
  return new Date().toISOString();
}

function itemKey(kind, id) {
  return kind + ':' + id;
}

function splitKey(key) {
  const at = String(key).indexOf(':');
  return [key.slice(0, at), key.slice(at + 1)];
}

function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (k) {
    return JSON.stringify(k) + ':' + stableStringify(value[k]);
  }).join(',') + '}';
}

function hashPayload(payload) {
  return crypto.createHash('sha1').update(stableStringify(payload)).digest('hex');
}

// Postgres 返回的 timestamptz 形如 `2026-10-30T00:12:33.123456+00:00`，
// 和 toISOString() 的 `...123Z` 不能按字符串比大小，统一按毫秒时间戳比。
function timeOf(value) {
  const t = Date.parse(String(value || ''));
  return isNaN(t) ? 0 : t;
}

/* ---------------- 字段白名单 ---------------- */

// 只同步「跟设备无关」的偏好。开机自启、关窗驻留属于单机设置，不同步。
function settingsPayload(settings) {
  const s = settings || {};
  const llm = s.llm || {};
  return {
    captureEnabled: !!s.captureEnabled,
    autoAdd: !!s.autoAdd,
    autoThreshold: Number(s.autoThreshold) || 0.82,
    notify: !!s.notify,
    reminderMinutes: Number(s.reminderMinutes) || 0,
    llm: {
      enabled: !!llm.enabled,
      baseUrl: String(llm.baseUrl || ''),
      model: String(llm.model || '')
    }
  };
}

// 合并远端设置时，绝不碰本机的 API Key 和 NapCat Token。
function applySettingsPayload(settings, payload) {
  if (!settings || !payload || typeof payload !== 'object') return false;
  const before = stableStringify(settingsPayload(settings));
  if (payload.captureEnabled !== undefined) settings.captureEnabled = !!payload.captureEnabled;
  if (payload.autoAdd !== undefined) settings.autoAdd = !!payload.autoAdd;
  if (payload.autoThreshold !== undefined) settings.autoThreshold = Number(payload.autoThreshold) || 0.82;
  if (payload.notify !== undefined) settings.notify = !!payload.notify;
  if (payload.reminderMinutes !== undefined) settings.reminderMinutes = Number(payload.reminderMinutes) || 0;
  if (payload.llm && typeof payload.llm === 'object') {
    if (!settings.llm) settings.llm = {};
    if (payload.llm.enabled !== undefined) settings.llm.enabled = !!payload.llm.enabled;
    if (payload.llm.baseUrl !== undefined) settings.llm.baseUrl = String(payload.llm.baseUrl);
    if (payload.llm.model !== undefined) settings.llm.model = String(payload.llm.model);
  }
  return stableStringify(settingsPayload(settings)) !== before;
}

/* ---------------- 本地条目 ---------------- */

// 提醒发送时间每次弹通知都会变，不该算作「日程内容改了」。
function eventPayload(event) {
  const copy = Object.assign({}, event);
  delete copy.reminderSentAt;
  return copy;
}

function collectLocal(data) {
  const items = new Map();
  const d = data || {};
  (Array.isArray(d.events) ? d.events : []).forEach(function (e) {
    if (!e || !e.id) return;
    items.set(itemKey('event', e.id), { kind: 'event', id: e.id, payload: eventPayload(e) });
  });
  (Array.isArray(d.sources) ? d.sources : []).forEach(function (s) {
    if (!s || !s.id) return;
    items.set(itemKey('source', s.id), { kind: 'source', id: s.id, payload: s });
  });
  (Array.isArray(d.inbox) ? d.inbox : []).forEach(function (i) {
    if (!i || !i.id) return;
    items.set(itemKey('inbox', i.id), { kind: 'inbox', id: i.id, payload: i });
  });
  (Array.isArray(d.templates) ? d.templates : []).forEach(function (t) {
    if (!t || !t.id) return;
    items.set(itemKey('template', t.id), { kind: 'template', id: t.id, payload: t });
  });
  // 周期定义本身也要跨设备：否则另一台机器只能看到展开后的日程，
  // 改一次整个周期就断了。
  (Array.isArray(d.series) ? d.series : []).forEach(function (s) {
    if (!s || !s.id) return;
    items.set(itemKey('series', s.id), { kind: 'series', id: s.id, payload: s });
  });
  items.set(SETTINGS_KEY, { kind: 'settings', id: 'main', payload: settingsPayload(d.settings) });
  return items;
}

/* ---------------- 差异 ---------------- */

/**
 * 和上次同步的指纹比：内容变了 = 改；上次有、这次没 = 删。
 * 首次同步（stateItems 为空）时 items 全部算「改」，会把本机数据推上云。
 */
function diffLocal(items, stateItems) {
  const known = stateItems || {};
  const changed = [];
  const deleted = [];
  items.forEach(function (it, key) {
    const h = hashPayload(it.payload);
    const prev = known[key];
    if (!prev || prev.hash !== h) {
      changed.push({ key: key, kind: it.kind, id: it.id, payload: it.payload, hash: h });
    }
  });
  Object.keys(known).forEach(function (key) {
    if (items.has(key)) return;
    const parts = splitKey(key);
    deleted.push({ key: key, kind: parts[0], id: parts[1] });
  });
  return { changed: changed, deleted: deleted };
}

/* ---------------- 合并远端 ---------------- */

function removeById(arr, id) {
  if (!Array.isArray(arr)) return false;
  const at = arr.findIndex(function (x) { return x && x.id === id; });
  if (at < 0) return false;
  arr.splice(at, 1);
  return true;
}

function upsertById(arr, item) {
  if (!Array.isArray(arr)) return false;
  const at = arr.findIndex(function (x) { return x && x.id === item.id; });
  if (at >= 0) {
    arr[at] = item;
    return true;
  }
  arr.push(item);
  return true;
}

/**
 * 把远端行合并进本地数据（就地修改 data）。
 * - localChangedKeys 里的条目由本地赢，不会被远端覆盖；
 * - 比墓碑还旧的远端行直接忽略，防止「删掉的日程被另一台机器复活」；
 * - 远端 updated_at 不晚于「上次同步过的版本」时也忽略。
 */
function applyRemoteRows(data, rows, ctx) {
  const stateItems = Object.assign({}, ctx.stateItems || {});
  const tombstones = Object.assign({}, ctx.tombstones || {});
  const localChanged = ctx.localChangedKeys || new Set();
  const d = data || {};

  let applied = 0;
  let settingsApplied = false;
  let maxRemoteTs = ctx.maxRemoteTs || '';

  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (!row || !row.kind || !row.id) return;
    const key = itemKey(row.kind, row.id);
    if (timeOf(row.updated_at) > timeOf(maxRemoteTs)) {
      maxRemoteTs = String(row.updated_at);
    }
    if (localChanged.has(key)) return; // 本地刚改过，本地赢，稍后推上去
    const stone = tombstones[key];
    if (stone && timeOf(row.updated_at) <= timeOf(stone)) return;

    if (row.deleted) {
      if (row.kind === 'event' && removeById(d.events, row.id)) applied++;
      else if (row.kind === 'source' && removeById(d.sources, row.id)) applied++;
      else if (row.kind === 'inbox' && removeById(d.inbox, row.id)) applied++;
      else if (row.kind === 'template' && removeById(d.templates, row.id)) applied++;
      else if (row.kind === 'series' && removeById(d.series, row.id)) applied++;
      delete stateItems[key];
      tombstones[key] = row.updated_at || nowISO();
      return;
    }

    const prev = stateItems[key];
    if (prev && timeOf(row.updated_at) <= timeOf(prev.updatedAt)) return;

    if (row.kind === 'event') {
      upsertById(d.events, row.payload);
      applied++;
    } else if (row.kind === 'source') {
      upsertById(d.sources, row.payload);
      applied++;
    } else if (row.kind === 'inbox') {
      upsertById(d.inbox, row.payload);
      applied++;
    } else if (row.kind === 'template') {
      if (!Array.isArray(d.templates)) d.templates = [];
      upsertById(d.templates, row.payload);
      applied++;
    } else if (row.kind === 'series') {
      if (!Array.isArray(d.series)) d.series = [];
      upsertById(d.series, row.payload);
      applied++;
    } else if (row.kind === 'settings') {
      if (applySettingsPayload(d.settings, row.payload)) {
        applied++;
        settingsApplied = true;
      }
    } else {
      return;
    }
    stateItems[key] = { hash: hashPayload(row.payload), updatedAt: String(row.updated_at || nowISO()) };
  });

  return {
    applied: applied,
    settingsApplied: settingsApplied,
    stateItems: stateItems,
    tombstones: tombstones,
    maxRemoteTs: maxRemoteTs
  };
}

function pruneTombstones(tombstones, now) {
  const cutoff = (now ? new Date(now) : new Date()).getTime() - TOMBSTONE_DAYS * 86400000;
  const out = {};
  Object.keys(tombstones || {}).forEach(function (key) {
    if (timeOf(tombstones[key]) >= cutoff) out[key] = tombstones[key];
  });
  return out;
}

module.exports = {
  ITEM_KINDS: ITEM_KINDS,
  SETTINGS_KEY: SETTINGS_KEY,
  TOMBSTONE_DAYS: TOMBSTONE_DAYS,
  nowISO: nowISO,
  itemKey: itemKey,
  splitKey: splitKey,
  stableStringify: stableStringify,
  hashPayload: hashPayload,
  timeOf: timeOf,
  settingsPayload: settingsPayload,
  applySettingsPayload: applySettingsPayload,
  collectLocal: collectLocal,
  diffLocal: diffLocal,
  applyRemoteRows: applyRemoteRows,
  pruneTombstones: pruneTombstones
};
