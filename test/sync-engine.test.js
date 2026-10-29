'use strict';

/*
 * 端到端：起一个假的 Supabase（Auth + PostgREST），
 * 用两台独立 userData 的引擎跑「推 → 拉 → 改 → 删」全流程。
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SyncEngine } = require('../src/sync-engine');

const ANON = 'anon-key';
const USER = { id: 'u-1', email: 'me@example.com' };

function readBody(req) {
  return new Promise(function (resolve) {
    let text = '';
    req.on('data', function (chunk) { text += chunk; });
    req.on('end', function () { resolve(text); });
  });
}

async function startMockSupabase() {
  const rows = new Map();
  const server = http.createServer(async function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = function (code, body) {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(body === null ? '' : JSON.stringify(body));
    };
    if (req.method === 'POST' && (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/signup')) {
      await readBody(req);
      return send(200, {
        access_token: 'access-' + Date.now(),
        refresh_token: 'refresh',
        expires_in: 3600,
        user: USER
      });
    }
    if (req.method === 'GET' && url.pathname === '/auth/v1/settings') {
      return send(200, { external: {} });
    }
    if (url.pathname === '/rest/v1/rixu_items') {
      if (req.method === 'GET') {
        const since = url.searchParams.get('updated_at') || '';
        let list = Array.from(rows.values());
        if (since.indexOf('gt.') === 0) {
          const cut = Date.parse(since.slice(3));
          list = list.filter(function (r) { return Date.parse(r.updated_at) > cut; });
        }
        return send(200, list);
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '[]');
        body.forEach(function (row) {
          rows.set([row.user_id, row.kind, row.id].join('|'), row);
        });
        return send(201, null);
      }
    }
    return send(404, { message: 'not found' });
  });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return {
    url: 'http://127.0.0.1:' + port,
    rows: rows,
    close: function () {
      // fetch 会复用 keep-alive 连接，Windows 上等 close 回调还可能触发 libuv 断言；
      // 这里主动断开 + unref，让测试进程能干净退出。
      try {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.unref();
        server.close();
      } catch (e) { /* ignore */ }
      return Promise.resolve();
    }
  };
}

function makeDevice(dir) {
  const dataFile = path.join(dir, 'data.json');
  const stateFile = path.join(dir, 'sync-state.json');
  const applied = [];
  const engine = new SyncEngine({
    readData: function () {
      if (!fs.existsSync(dataFile)) return null;
      return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    },
    writeData: function (data) { fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8'); },
    dataExists: function () { return fs.existsSync(dataFile); },
    readState: function () {
      if (!fs.existsSync(stateFile)) return null;
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    },
    writeState: function (state) { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8'); },
    encrypt: function (text) { return Buffer.from(text, 'utf8').toString('base64'); },
    decrypt: function (blob) { return Buffer.from(blob, 'base64').toString('utf8'); },
    onApplied: function (data) { applied.push(data); },
    log: function () {}
  });
  return { engine: engine, dataFile: dataFile, applied: applied };
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function seedOneEvent() {
  return {
    version: 1,
    events: [{
      id: 'evt_a',
      title: '家长会',
      start: '2026-11-05T19:00',
      end: '2026-11-05T20:00',
      createdAt: '2026-10-30T00:00:00.000Z'
    }],
    sources: [],
    inbox: [],
    settings: {
      captureEnabled: true,
      autoAdd: true,
      autoThreshold: 0.82,
      notify: true,
      reminderMinutes: 10,
      closeToTray: true,
      openAtLogin: true,
      llm: { enabled: true, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'sk-should-never-upload' },
      napcat: { enabled: true, url: 'ws://127.0.0.1:3001', token: 'napcat-should-never-upload' }
    },
    meta: { onboarded: true, hashes: [], notified: {} }
  };
}

test('两台设备：推、拉、改、删全流程收敛', async function (t) {
  const server = await startMockSupabase();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rixu-sync-'));
  t.after(async function () {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dirA = path.join(root, 'device-a');
  const dirB = path.join(root, 'device-b');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  const A = makeDevice(dirA);
  fs.writeFileSync(A.dataFile, JSON.stringify(seedOneEvent(), null, 2), 'utf8');

  // ---- 设备 A：配置、注册/登录，自动全量推 ----
  const cfg = await A.engine.configure({ url: server.url, anonKey: ANON });
  assert.strictEqual(cfg.ok, true, cfg.error);

  const signInA = await A.engine.signIn({ email: USER.email, password: 'secret123' });
  assert.strictEqual(signInA.ok, true, signInA.error);
  assert.ok(signInA.sync && signInA.sync.ok, 'signIn 后应立即同步');

  assert.strictEqual(server.rows.size, 2, '应推送 1 条日程 + 1 条设置');
  const uploaded = JSON.stringify(Array.from(server.rows.values()));
  assert.ok(!/sk-should-never-upload/.test(uploaded), 'API Key 不能上传');
  assert.ok(!/napcat-should-never-upload/.test(uploaded), 'NapCat Token 不能上传');

  // ---- 设备 B：空设备登录，只拉不推 ----
  const B = makeDevice(dirB);
  const cfgB = await B.engine.configure({ url: server.url, anonKey: ANON });
  assert.strictEqual(cfgB.ok, true, cfgB.error);
  const signInB = await B.engine.signIn({ email: USER.email, password: 'secret123' });
  assert.strictEqual(signInB.ok, true, signInB.error);

  const dataB = JSON.parse(fs.readFileSync(B.dataFile, 'utf8'));
  assert.strictEqual(dataB.events.length, 1);
  assert.strictEqual(dataB.events[0].title, '家长会');
  assert.strictEqual(dataB.settings.llm.apiKey, undefined, '密钥不该从云端带下来');
  assert.strictEqual(server.rows.size, 2, '新设备首次同步不应删改云端');

  // ---- B 新增一条，A 能收到 ----
  await wait(10);
  dataB.events.push({ id: 'evt_b', title: '交作业', start: '2026-11-06T09:00', end: '2026-11-06T10:00' });
  fs.writeFileSync(B.dataFile, JSON.stringify(dataB, null, 2), 'utf8');
  const pushB = await B.engine.syncNow('test');
  assert.strictEqual(pushB.ok, true, pushB.error);

  await wait(10);
  const pullA = await A.engine.syncNow('test');
  assert.strictEqual(pullA.ok, true, pullA.error);
  const dataA = JSON.parse(fs.readFileSync(A.dataFile, 'utf8'));
  assert.strictEqual(dataA.events.length, 2);
  assert.ok(dataA.events.some(function (e) { return e.id === 'evt_b'; }));

  // ---- A 删除一条，B 也要删 ----
  await wait(10);
  const keepA = dataA.events.filter(function (e) { return e.id !== 'evt_a'; });
  dataA.events = keepA;
  fs.writeFileSync(A.dataFile, JSON.stringify(dataA, null, 2), 'utf8');
  const delA = await A.engine.syncNow('test');
  assert.strictEqual(delA.ok, true, delA.error);

  await wait(10);
  const pullB = await B.engine.syncNow('test');
  assert.strictEqual(pullB.ok, true, pullB.error);
  const dataB2 = JSON.parse(fs.readFileSync(B.dataFile, 'utf8'));
  assert.strictEqual(dataB2.events.length, 1);
  assert.strictEqual(dataB2.events[0].id, 'evt_b');

  // A 本机的 API Key 仍然在
  assert.strictEqual(JSON.parse(fs.readFileSync(A.dataFile, 'utf8')).settings.llm.apiKey, 'sk-should-never-upload');
});

test('退出登录后不再同步，本地数据保留', async function (t) {
  const server = await startMockSupabase();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rixu-sync-'));
  t.after(async function () {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dir = path.join(root, 'device');
  fs.mkdirSync(dir, { recursive: true });
  const A = makeDevice(dir);
  fs.writeFileSync(A.dataFile, JSON.stringify(seedOneEvent(), null, 2), 'utf8');

  await A.engine.configure({ url: server.url, anonKey: ANON });
  const signIn = await A.engine.signIn({ email: USER.email, password: 'secret123' });
  assert.strictEqual(signIn.ok, true, signIn.error);

  const out = A.engine.signOut();
  assert.strictEqual(out.status.signedIn, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(A.dataFile, 'utf8')).events.length, 1);

  const again = await A.engine.syncNow('test');
  assert.strictEqual(again.ok, false);
});
