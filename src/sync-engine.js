/*
 * 日序 · 同步引擎
 *
 * 把「本地 data.json」「同步状态文件」「Supabase」串起来：
 *   1. 比对本地内容指纹，找出改过 / 删掉的条目；
 *   2. 先拉远端增量，按条目合并（本地刚改过的优先）；
 *   3. 再把本地改动推上去；
 *   4. 全程不碰 settings.llm.apiKey / settings.napcat.token。
 *
 * 状态文件单独存放（不含日程正文），只记指纹、时间游标和加密后的登录态。
 */
'use strict';

const core = require('./sync-core');
const net = require('./sync-net');

const REFRESH_MARGIN_MS = 60 * 1000;

function makeEmptyState() {
  return {
    config: { url: '', anonKey: '' },
    session: null,        // { enc: boolean, data: string }
    sessionInfo: { email: '', userId: '' },
    itemsOwner: '',
    items: {},
    tombstones: {},
    lastPullAt: '',
    lastSyncAt: '',
    lastError: ''
  };
}

function parsesTo(value) {
  const t = Date.parse(String(value || ''));
  return isNaN(t) ? 0 : t;
}

class SyncEngine {
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
      base.config = Object.assign(base.config, raw.config || {});
      base.session = raw.session || null;
      base.sessionInfo = Object.assign(base.sessionInfo, raw.sessionInfo || {});
      base.itemsOwner = raw.itemsOwner || '';
      base.items = raw.items && typeof raw.items === 'object' ? raw.items : {};
      base.tombstones = raw.tombstones && typeof raw.tombstones === 'object' ? raw.tombstones : {};
      base.lastPullAt = raw.lastPullAt || '';
      base.lastSyncAt = raw.lastSyncAt || '';
      base.lastError = raw.lastError || '';
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
      this.log('write sync state failed', err && err.message);
    }
    return state;
  }

  /* ---------------- 登录态 ---------------- */

  readSession() {
    const state = this.readState();
    if (!state.session || !state.session.data) return null;
    try {
      const json = this.deps.decrypt ? this.deps.decrypt(state.session.data) : state.session.data;
      const session = JSON.parse(json);
      if (!session || !session.access) return null;
      return session;
    } catch (err) {
      this.log('decrypt session failed', err && err.message);
      return null;
    }
  }

  writeSession(session) {
    if (!session) {
      this.saveState({ session: null, sessionInfo: { email: '', userId: '' } });
      return;
    }
    const json = JSON.stringify(session);
    let stored;
    try {
      stored = { enc: true, data: this.deps.encrypt ? this.deps.encrypt(json) : json };
    } catch (err) {
      // safeStorage 不可用时退回明文——只在用户自己的机器上，仍然只存 token。
      stored = { enc: false, data: json };
    }
    this.saveState({
      session: stored,
      sessionInfo: { email: session.email || '', userId: session.userId || '' }
    });
  }

  async ensureSession() {
    const session = this.readSession();
    if (!session) return { ok: false, error: '还没有登录。' };
    if (session.expiresAt && session.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return { ok: true, session: session };
    }
    const cfg = this.readState().config;
    if (!session.refresh) return { ok: false, error: '登录已失效，请重新登录。' };
    const result = await net.refreshSession({ url: cfg.url, anonKey: cfg.anonKey, refresh: session.refresh });
    if (!result.ok) return { ok: false, error: result.error || '登录已失效，请重新登录。' };
    const merged = Object.assign({}, session, result.session);
    this.writeSession(merged);
    return { ok: true, session: merged };
  }

  status() {
    const state = this.readState();
    const session = this.readSession();
    return {
      configured: !!(state.config && state.config.url && state.config.anonKey),
      url: (state.config && state.config.url) || '',
      signedIn: !!session,
      email: (session && session.email) || (state.sessionInfo && state.sessionInfo.email) || '',
      syncing: this.syncing,
      lastSyncAt: state.lastSyncAt || '',
      lastError: state.lastError || ''
    };
  }

  /* ---------------- 操作 ---------------- */

  async configure(payload) {
    const url = net.normalizeUrl(payload && payload.url);
    const anonKey = String((payload && payload.anonKey) || '').trim();
    if (!net.isHttpUrl(url)) return { ok: false, error: '地址要以 https:// 开头。' };
    if (!anonKey) return { ok: false, error: '还没填 anon key。' };
    const check = await net.checkConfig({ url: url, anonKey: anonKey });
    if (!check.ok) return check;
    this.saveState({ config: { url: url, anonKey: anonKey }, lastError: '' });
    return { ok: true, status: this.status() };
  }

  async signIn(payload) {
    const state = this.readState();
    const cfg = state.config;
    if (!cfg.url || !cfg.anonKey) return { ok: false, error: '先填 Supabase 地址和 anon key。' };
    const email = String((payload && payload.email) || '').trim();
    const password = String((payload && payload.password) || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: '邮箱格式不对。' };
    if (password.length < 6) return { ok: false, error: '密码至少 6 位。' };

    const result = await net.signIn({ url: cfg.url, anonKey: cfg.anonKey, email: email, password: password });
    if (!result.ok) return result;

    const session = Object.assign({ email: email }, result.session);
    // 换了账号：清掉上一账号的同步游标，避免把别人的数据当成自己的基线。
    if (state.itemsOwner && state.itemsOwner !== session.userId) {
      this.saveState({ items: {}, tombstones: {}, lastPullAt: '', lastSyncAt: '', itemsOwner: session.userId });
    } else {
      this.saveState({ itemsOwner: session.userId });
    }
    this.writeSession(session);
    const sync = await this.syncNow('signin');
    return { ok: true, status: this.status(), sync: sync };
  }

  async signUp(payload) {
    const state = this.readState();
    const cfg = state.config;
    if (!cfg.url || !cfg.anonKey) return { ok: false, error: '先填 Supabase 地址和 anon key。' };
    const email = String((payload && payload.email) || '').trim();
    const password = String((payload && payload.password) || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: '邮箱格式不对。' };
    if (password.length < 6) return { ok: false, error: '密码至少 6 位。' };

    const result = await net.signUp({ url: cfg.url, anonKey: cfg.anonKey, email: email, password: password });
    if (!result.ok) return result;

    const session = Object.assign({ email: email }, result.session);
    this.saveState({ items: {}, tombstones: {}, lastPullAt: '', lastSyncAt: '', itemsOwner: session.userId });
    this.writeSession(session);
    const sync = await this.syncNow('signup');
    return { ok: true, status: this.status(), sync: sync };
  }

  signOut() {
    this.saveState({
      session: null,
      sessionInfo: { email: '', userId: '' },
      itemsOwner: '',
      items: {},
      tombstones: {},
      lastPullAt: '',
      lastSyncAt: '',
      lastError: ''
    });
    return { ok: true, status: this.status() };
  }

  /* ---------------- 同步 ---------------- */

  async syncNow(reason) {
    if (this.syncing) return { ok: false, error: '正在同步，稍等。' };
    const state = this.readState();
    const cfg = state.config;
    if (!cfg.url || !cfg.anonKey) return { ok: false, error: '还没配置同步服务器。' };

    const auth = await this.ensureSession();
    if (!auth.ok) {
      this.saveState({ lastError: auth.error });
      return { ok: false, error: auth.error };
    }
    const session = auth.session;
    if (state.itemsOwner && session.userId && state.itemsOwner !== session.userId) {
      this.saveState({ items: {}, tombstones: {}, lastPullAt: '', lastSyncAt: '', itemsOwner: session.userId });
      state.items = {};
      state.tombstones = {};
      state.lastPullAt = '';
      state.lastSyncAt = '';
    }

    this.syncing = true;
    this.saveState({ lastError: '' });
    try {
      const dataExists = this.deps.dataExists ? !!this.deps.dataExists() : !!this.deps.readData();
      const local = this.deps.readData() || { events: [], sources: [], inbox: [], settings: {} };
      const firstSync = !state.lastSyncAt;
      const preItems = core.collectLocal(local);
      const preDiff = core.diffLocal(preItems, state.items);

      // 本地改过、本地删掉的条目都算「本地刚动过」：拉取时不能被远端旧版本覆盖。
      const protectedKeys = new Set(preDiff.changed.map(function (c) { return c.key; }));
      if (dataExists && !firstSync) {
        preDiff.deleted.forEach(function (d) { protectedKeys.add(d.key); });
      }
      // 空设备第一次同步：本机只有一份默认设置，别拿它盖掉云端已有的偏好。
      const hasLocalContent = (Array.isArray(local.events) && local.events.length > 0) ||
        (Array.isArray(local.sources) && local.sources.length > 0) ||
        (Array.isArray(local.inbox) && local.inbox.length > 0) ||
        (Array.isArray(local.templates) && local.templates.length > 0) ||
        (Array.isArray(local.series) && local.series.length > 0);
      if (firstSync && !hasLocalContent) protectedKeys.delete(core.SETTINGS_KEY);
      if (!dataExists && !firstSync) {
        // 本地数据文件丢了但历史游标还在，保守处理：只拉不删。
        this.log('sync: local data missing, skip deletions');
      }

      const pulled = await net.pull({
        url: cfg.url,
        anonKey: cfg.anonKey,
        access: session.access,
        since: state.lastPullAt || ''
      });
      if (!pulled.ok) {
        this.saveState({ lastError: pulled.error });
        return { ok: false, error: pulled.error };
      }

      // 远端合并到「最新读到的本地数据」上，减少和渲染层保存互相覆盖的窗口。
      const fresh = this.deps.readData() || local;
      const merged = core.applyRemoteRows(fresh, pulled.rows, {
        stateItems: state.items,
        tombstones: state.tombstones,
        localChangedKeys: protectedKeys,
        maxRemoteTs: state.lastPullAt
      });
      if (merged.applied > 0 && this.deps.writeData) this.deps.writeData(fresh);

      // 合并之后再算要推什么：新设备刚拉下云端设置，不会又把本机默认值盖回去。
      const postDiff = core.diffLocal(core.collectLocal(fresh), merged.stateItems);
      // 首次同步绝不上报删除：新设备刚装好、本地还没有数据时，不能把云端的日程删光。
      const deletions = dataExists && !firstSync ? postDiff.deleted : [];

      const stamp = core.nowISO();
      const pushRows = postDiff.changed.map(function (c) {
        return { kind: c.kind, id: c.id, payload: c.payload, updated_at: stamp, deleted: false };
      }).concat(deletions.map(function (d) {
        return { kind: d.kind, id: d.id, payload: {}, updated_at: stamp, deleted: true };
      }));

      if (pushRows.length) {
        const pushed = await net.push({
          url: cfg.url,
          anonKey: cfg.anonKey,
          access: session.access,
          userId: session.userId,
          rows: pushRows
        });
        if (!pushed.ok) {
          this.saveState({ lastError: pushed.error });
          return { ok: false, error: pushed.error };
        }
      }

      const nextItems = Object.assign({}, merged.stateItems);
      postDiff.changed.forEach(function (c) {
        nextItems[c.key] = { hash: c.hash, updatedAt: stamp };
      });
      const nextStones = Object.assign({}, merged.tombstones);
      deletions.forEach(function (d) {
        delete nextItems[d.key];
        nextStones[d.key] = stamp;
      });

      const nextPullAt = merged.maxRemoteTs && parsesTo(merged.maxRemoteTs) > parsesTo(state.lastPullAt)
        ? merged.maxRemoteTs
        : state.lastPullAt;

      this.saveState({
        items: nextItems,
        tombstones: core.pruneTombstones(nextStones, stamp),
        lastPullAt: nextPullAt,
        lastSyncAt: stamp,
        lastError: ''
      });

      const summary = {
        reason: reason || 'manual',
        pushed: pushRows.length,
        pulled: merged.applied,
        applied: merged.applied,
        at: stamp
      };
      if (merged.applied > 0 && typeof this.deps.onApplied === 'function') {
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

module.exports = { SyncEngine: SyncEngine, makeEmptyState: makeEmptyState };
