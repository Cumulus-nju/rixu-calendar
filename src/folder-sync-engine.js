/*
 * 日序 · 同步文件夹引擎
 *
 * 不经过服务器：把一个合并后的 `rixu-sync.json` 写进用户选的同步盘文件夹。
 * 两台电脑各自读写同一个文件，按条目合并；云盘生成的冲突副本也会一起合并。
 *
 * 复用 sync-core 的指纹 / 差异 / 合并 / 墓碑，只把「远端」从 Supabase
 * 换成文件夹里的 JSON 快照。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./sync-core');
const fc = require('./folder-sync-core');

const TOMBSTONE_DAYS = 90;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function makeEmptyState() {
  return {
    folder: '',
    enabled: false,
    calendarId: '',
    items: {},
    tombstones: {},
    lastSyncAt: '',
    lastError: ''
  };
}

function safeData(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  if (!Array.isArray(d.events)) d.events = [];
  if (!Array.isArray(d.sources)) d.sources = [];
  if (!Array.isArray(d.inbox)) d.inbox = [];
  if (!Array.isArray(d.templates)) d.templates = [];
  if (!Array.isArray(d.series)) d.series = [];
  if (!d.settings || typeof d.settings !== 'object' || Array.isArray(d.settings)) d.settings = {};
  return d;
}

class FolderSyncEngine {
  constructor(deps) {
    this.deps = deps || {};
    this.syncing = false;
    this.state = null;
  }

  log() {
    if (typeof this.deps.log === 'function') this.deps.log.apply(null, arguments);
  }

  readState() {
    if (this.state) return this.state;
    let raw = null;
    try { raw = this.deps.readState ? this.deps.readState() : null; } catch (e) { raw = null; }
    const base = makeEmptyState();
    if (raw && typeof raw === 'object') {
      base.folder = String(raw.folder || '');
      base.enabled = !!raw.enabled;
      base.calendarId = String(raw.calendarId || '');
      base.items = raw.items && typeof raw.items === 'object' ? raw.items : {};
      base.tombstones = raw.tombstones && typeof raw.tombstones === 'object' ? raw.tombstones : {};
      base.lastSyncAt = String(raw.lastSyncAt || '');
      base.lastError = String(raw.lastError || '');
    }
    this.state = base;
    return base;
  }

  saveState(patch) {
    const state = Object.assign(this.readState(), patch || {});
    this.state = state;
    try {
      if (this.deps.writeState) this.deps.writeState(state);
    } catch (err) {
      this.log('write folder sync state failed', err && err.message);
    }
    return state;
  }

  status() {
    const state = this.readState();
    return {
      configured: !!state.folder,
      enabled: !!(state.folder && state.enabled),
      folder: state.folder || '',
      calendarId: state.calendarId || '',
      syncing: this.syncing,
      lastSyncAt: state.lastSyncAt || '',
      lastError: state.lastError || ''
    };
  }

  deviceName() {
    try {
      return String(os.hostname() || 'device').slice(0, 40);
    } catch (err) {
      return 'device';
    }
  }

  /* ---------------- 文件读写 ---------------- */

  async readSnapshotFiles(folder) {
    let names;
    try {
      names = fs.readdirSync(folder);
    } catch (err) {
      throw new Error('打不开同步文件夹：' + String(err && err.message || err));
    }
    const out = [];
    for (const name of names) {
      if (!fc.isSnapshotFile(name)) continue;
      const full = path.join(folder, name);
      try {
        if (!fs.statSync(full).isFile()) continue;
      } catch (err) {
        continue;
      }
      let lastError = null;
      let ok = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const text = fs.readFileSync(full, 'utf8').replace(/^\ufeff/, '');
          if (!text.trim()) throw new Error('文件为空');
          out.push({ name: name, data: JSON.parse(text) });
          ok = true;
          break;
        } catch (err) {
          lastError = err;
          // 云盘客户端可能正在中途写文件；稍等一下再读。
          await sleep(120);
        }
      }
      if (!ok) out.push({ name: name, error: String(lastError && lastError.message || lastError) });
    }
    return out;
  }

  async writeSnapshot(folder, snapshot) {
    const target = path.join(folder, fc.SNAPSHOT_FILE);
    const body = JSON.stringify(snapshot, null, 2);
    const tmp = path.join(folder, '.rixu-sync-' + process.pid + '-' + Date.now() + '.tmp');
    fs.writeFileSync(tmp, body, 'utf8');
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.renameSync(tmp, target);
        return;
      } catch (err) {
        lastError = err;
        await sleep(120 * (attempt + 1));
      }
    }
    // 某些同步盘会短暂锁住目标文件；退一步直接覆盖，至少别让这次同步白做。
    try {
      fs.writeFileSync(target, body, 'utf8');
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
      return;
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
      throw lastError || err;
    }
  }

  // 云盘生成的冲突副本合并完后改名成 `.merged`，不删除内容，也不会被下次同步重复读取。
  renameMergedCopies(folder, files) {
    const renamed = [];
    (Array.isArray(files) ? files : []).forEach((file) => {
      if (!file || !file.name || file.error) return;
      if (file.name === fc.SNAPSHOT_FILE) return;
      if (!fc.isSnapshotFile(file.name)) return;
      const from = path.join(folder, file.name);
      let to = path.join(folder, file.name + '.merged');
      try {
        if (fs.existsSync(to)) to = to + '.' + Date.now();
        fs.renameSync(from, to);
        renamed.push(file.name);
      } catch (err) {
        this.log('rename merged copy failed', file.name, err && err.message);
      }
    });
    return renamed;
  }

  /* ---------------- 配置 ---------------- */

  async configure(folder, opts) {
    opts = opts || {};
    const raw = String(folder || '').trim();
    if (!raw) return { ok: false, error: '先选一个同步文件夹。' };
    const resolved = path.resolve(raw);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: '这个路径不是文件夹。' };
      const probe = path.join(resolved, '.rixu-write-test');
      fs.writeFileSync(probe, 'ok', 'utf8');
      fs.unlinkSync(probe);
    } catch (err) {
      return { ok: false, error: '这个文件夹不能写入：' + String(err && err.message || err).slice(0, 120) };
    }

    const state = this.readState();
    let remote = null;
    try {
      remote = fc.mergeSnapshots(await this.readSnapshotFiles(resolved));
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
    if (!remote.ok) return { ok: false, error: remote.error };

    const sameCalendar = !!(state.calendarId && remote.calendarId && state.calendarId === remote.calendarId);
    if (remote.calendarId && !sameCalendar && !opts.join) {
      return {
        ok: false,
        needsJoin: true,
        folder: resolved,
        calendarId: remote.calendarId,
        error: '这个文件夹里已有日序日历。确认加入吗？'
      };
    }

    if (sameCalendar) {
      this.saveState({ folder: resolved, enabled: true, lastError: '' });
    } else {
      this.saveState({
        folder: resolved,
        enabled: true,
        calendarId: remote.calendarId || '',
        items: {},
        tombstones: {},
        lastSyncAt: '',
        lastError: ''
      });
    }

    const sync = await this.syncNow(opts.join ? 'join' : 'configure');
    return { ok: true, status: this.status(), sync: sync };
  }

  disable() {
    this.saveState({ enabled: false });
    return { ok: true, status: this.status() };
  }

  /* ---------------- 同步 ---------------- */

  async syncNow(reason) {
    if (this.syncing) return { ok: false, error: '正在同步，稍等。' };
    const state = this.readState();
    if (!state.folder) return { ok: false, error: '先选一个同步文件夹。' };
    if (!state.enabled) return { ok: false, error: '同步文件夹已停用。' };

    this.syncing = true;
    this.saveState({ lastError: '' });
    try {
      const rawLocal = this.deps.readData ? this.deps.readData() : null;
      const dataExists = this.deps.dataExists ? !!this.deps.dataExists() : !!rawLocal;
      const local = safeData(rawLocal);
      const files = await this.readSnapshotFiles(state.folder);
      const remote = fc.mergeSnapshots(files);
      if (!remote.ok) {
        this.saveState({ lastError: remote.error });
        return { ok: false, error: remote.error };
      }
      if (state.calendarId && remote.calendarId && state.calendarId !== remote.calendarId) {
        const error = '这个文件夹里是另一个日序日历。换回原来的文件夹，或确认加入后再同步。';
        this.saveState({ lastError: error });
        return { ok: false, error: error };
      }
      const calendarId = state.calendarId || remote.calendarId || fc.newCalendarId();
      const firstSync = !state.lastSyncAt;
      const preItems = core.collectLocal(local);
      const preDiff = core.diffLocal(preItems, state.items);
      const protectedKeys = new Set(preDiff.changed.map(function (c) { return c.key; }));
      if (dataExists && !firstSync) {
        preDiff.deleted.forEach(function (d) { protectedKeys.add(d.key); });
      }
      const hasLocalContent = local.events.length > 0 || local.sources.length > 0 ||
        local.inbox.length > 0 || local.templates.length > 0 || local.series.length > 0;
      if (firstSync && !hasLocalContent) protectedKeys.delete(core.SETTINGS_KEY);

      const fresh = safeData(this.deps.readData ? this.deps.readData() : local);
      const applied = core.applyRemoteRows(fresh, remote.rows, {
        stateItems: state.items,
        tombstones: state.tombstones,
        localChangedKeys: protectedKeys,
        maxRemoteTs: ''
      });
      if (applied.applied > 0 && this.deps.writeData) this.deps.writeData(fresh);

      const postDiff = core.diffLocal(core.collectLocal(fresh), applied.stateItems);
      const deletions = dataExists && !firstSync ? postDiff.deleted : [];

      const stamp = core.nowISO();
      const rowMap = new Map();
      remote.rows.forEach(function (row) {
        rowMap.set(fc.keyOf(row.kind, row.id), row);
      });
      postDiff.changed.forEach(function (c) {
        rowMap.set(c.key, {
          kind: c.kind,
          id: c.id,
          payload: c.payload,
          updated_at: stamp,
          deleted: false
        });
      });

      const stones = Object.assign({}, applied.tombstones);
      deletions.forEach(function (d) {
        stones[d.key] = stamp;
        rowMap.set(d.key, {
          kind: d.kind,
          id: d.id,
          payload: {},
          updated_at: stamp,
          deleted: true
        });
      });
      const pruned = core.pruneTombstones(stones, stamp);
      // 快照里过期墓碑不保留。近期墓碑要盖过旧行：否则一台还没看到删除的
      // 设备写回来的旧版本，会把已删条目重新塞进快照。
      Array.from(rowMap.keys()).forEach(function (key) {
        const row = rowMap.get(key);
        if (row && row.deleted && !pruned[key]) rowMap.delete(key);
      });
      Object.keys(pruned).forEach(function (key) {
        const row = rowMap.get(key);
        const stoneTime = fc.timeOf(pruned[key]);
        if (!row || stoneTime >= fc.timeOf(row.updated_at)) {
          const parts = core.splitKey(key);
          rowMap.set(key, {
            kind: parts[0],
            id: parts[1],
            payload: {},
            updated_at: pruned[key],
            deleted: true
          });
        }
      });

      const snapshot = fc.makeSnapshot(calendarId, Array.from(rowMap.values()), {
        device: this.deviceName(),
        updatedAt: stamp
      });
      // 没有本地改动时不要每 30 秒重写一次同步文件，否则云盘会一直上传，
      // 还可能凭空制造冲突副本。只有首次、有改动、或合并了冲突副本时才写。
      const mainPath = path.join(state.folder, fc.SNAPSHOT_FILE);
      const mainExists = fs.existsSync(mainPath);
      const generatedCalendarId = !state.calendarId && !remote.calendarId;
      const needsWrite = !mainExists || remote.files === 0 || remote.files > 1 ||
        postDiff.changed.length > 0 || deletions.length > 0 || generatedCalendarId;
      let mergedCopies = [];
      if (needsWrite) {
        await this.writeSnapshot(state.folder, snapshot);
        mergedCopies = this.renameMergedCopies(state.folder, files);
      }

      const nextItems = Object.assign({}, applied.stateItems);
      postDiff.changed.forEach(function (c) {
        nextItems[c.key] = { hash: c.hash, updatedAt: stamp };
      });
      deletions.forEach(function (d) { delete nextItems[d.key]; });

      this.saveState({
        folder: state.folder,
        enabled: true,
        calendarId: calendarId,
        items: nextItems,
        tombstones: pruned,
        lastSyncAt: stamp,
        lastError: ''
      });

      const summary = {
        reason: reason || 'manual',
        pushed: postDiff.changed.length + deletions.length,
        pulled: applied.applied,
        applied: applied.applied,
        files: remote.files,
        conflicts: mergedCopies.length,
        wrote: needsWrite,
        warnings: remote.warnings,
        at: stamp
      };
      if (applied.applied > 0 && typeof this.deps.onApplied === 'function') {
        this.deps.onApplied(fresh, summary);
      }
      return { ok: true, summary: summary, status: this.status() };
    } catch (err) {
      const message = String((err && err.message) || err || '同步失败').slice(0, 200);
      this.saveState({ lastError: message });
      return { ok: false, error: message };
    } finally {
      this.syncing = false;
    }
  }
}

module.exports = {
  FolderSyncEngine: FolderSyncEngine,
  makeEmptyState: makeEmptyState,
  safeData: safeData,
  TOMBSTONE_DAYS: TOMBSTONE_DAYS
};
