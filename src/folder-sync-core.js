/*
 * 日序 · 同步文件夹核心
 *
 * 零账号方案：把日历合并成一份 `rixu-sync.json`，放进 OneDrive / 坚果云
 * 等同步盘文件夹。另一台电脑读同一个文件，按条目合并。
 *
 * 这一层只做纯计算：
 * - 读一份快照对象，校验并取出条目；
 * - 合并多份快照（包括云盘生成的冲突副本），同一条取更新时间更新的；
 * - 生成新的快照对象。
 *
 * 不依赖 Electron、不碰文件系统，便于单测。
 */
'use strict';

const crypto = require('crypto');

const SNAPSHOT_FILE = 'rixu-sync.json';
const SNAPSHOT_SCHEMA = 1;
const SNAPSHOT_APP = 'rixu-calendar';
const KINDS = ['event', 'source', 'inbox', 'template', 'series', 'settings'];

function keyOf(kind, id) {
  return kind + ':' + id;
}

function isSnapshotFile(name) {
  const text = String(name || '');
  return /^rixu-sync.*\.json$/i.test(text) && !/\.merged$/i.test(text);
}

function newCalendarId() {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  return 'cal_' + Date.now().toString(36) + '_' + crypto.randomBytes(6).toString('hex');
}

function timeOf(value) {
  const t = Date.parse(String(value || ''));
  return isNaN(t) ? 0 : t;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const kind = String(row.kind || '');
  const id = String(row.id || '');
  if (KINDS.indexOf(kind) < 0 || !id) return null;
  const updated = timeOf(row.updated_at);
  if (!updated) return null;
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {};
  return {
    kind: kind,
    id: id,
    payload: payload,
    updated_at: new Date(updated).toISOString(),
    deleted: !!row.deleted
  };
}

// 同一条目出现多次时：更新时间新的赢；同一毫秒里墓碑优先，
// 宁可少复活一条，也不要把已经删掉的日程悄悄带回来。
function pickNewer(a, b) {
  const ta = timeOf(a.updated_at);
  const tb = timeOf(b.updated_at);
  if (ta !== tb) return ta > tb ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return a;
}

function parseSnapshot(name, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, name: name, error: '不是对象' };
  }
  const items = data.items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    return { ok: false, name: name, error: '没有 items' };
  }
  const rows = [];
  Object.keys(items).forEach(function (key) {
    const row = normalizeRow(items[key]);
    if (row) rows.push(row);
  });
  return {
    ok: true,
    name: name,
    calendarId: String(data.calendarId || ''),
    rows: rows
  };
}

/**
 * 合并多份快照。
 * files: [{ name, data }] 或 [{ name, error }]
 */
function mergeSnapshots(files) {
  const items = new Map();
  const warnings = [];
  const ids = [];
  let used = 0;

  (Array.isArray(files) ? files : []).forEach(function (file) {
    if (!file || file.error) {
      if (file && file.name) warnings.push(file.name + ' 读不出来，已跳过：' + file.error);
      return;
    }
    const parsed = parseSnapshot(file.name, file.data);
    if (!parsed.ok) {
      warnings.push(file.name + ' 不是有效的日序同步文件，已跳过。');
      return;
    }
    used += 1;
    if (parsed.calendarId && ids.indexOf(parsed.calendarId) < 0) ids.push(parsed.calendarId);
    parsed.rows.forEach(function (row) {
      const key = keyOf(row.kind, row.id);
      const prev = items.get(key);
      items.set(key, prev ? pickNewer(prev, row) : row);
    });
  });

  if (ids.length > 1) {
    return {
      ok: false,
      error: '这个文件夹里有多个不同的日序日历，请只保留一套。',
      warnings: warnings,
      files: used
    };
  }

  const rows = Array.from(items.values());
  return {
    ok: true,
    calendarId: ids[0] || '',
    items: items,
    rows: rows,
    warnings: warnings,
    files: used
  };
}

/**
 * 生成快照对象。
 * rows: [{ kind, id, payload, updated_at, deleted }]
 */
function makeSnapshot(calendarId, rows, meta) {
  const items = {};
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    const normalized = normalizeRow(row);
    if (normalized) items[keyOf(normalized.kind, normalized.id)] = normalized;
  });
  return {
    app: SNAPSHOT_APP,
    schema: SNAPSHOT_SCHEMA,
    calendarId: String(calendarId || ''),
    device: String((meta && meta.device) || ''),
    updatedAt: String((meta && meta.updatedAt) || new Date().toISOString()),
    items: items
  };
}

module.exports = {
  SNAPSHOT_FILE: SNAPSHOT_FILE,
  SNAPSHOT_SCHEMA: SNAPSHOT_SCHEMA,
  SNAPSHOT_APP: SNAPSHOT_APP,
  KINDS: KINDS,
  keyOf: keyOf,
  isSnapshotFile: isSnapshotFile,
  newCalendarId: newCalendarId,
  timeOf: timeOf,
  normalizeRow: normalizeRow,
  parseSnapshot: parseSnapshot,
  mergeSnapshots: mergeSnapshots,
  makeSnapshot: makeSnapshot
};
