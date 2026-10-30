'use strict';

/*
 * 文件夹同步端到端：两个独立 userData，共用同一个同步文件夹。
 * 覆盖：首推、第二台加入、增删双向、冲突副本、墓碑防复活、密钥不上传。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FolderSyncEngine } = require('../src/folder-sync-engine');
const fc = require('../src/folder-sync-core');

function seedData() {
  return {
    version: 1,
    events: [{
      id: 'evt_a',
      title: '组会',
      start: '2026-11-02T10:00',
      end: '2026-11-02T11:00',
      createdAt: '2026-10-30T00:00:00.000Z'
    }],
    sources: [],
    inbox: [],
    templates: [{ id: 'tpl_1', title: '交作业', time: '20:00', endTime: '20:30', offsetDays: 0 }],
    series: [],
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

function makeDevice(dir, initialData) {
  fs.mkdirSync(dir, { recursive: true });
  const dataFile = path.join(dir, 'data.json');
  const stateFile = path.join(dir, 'folder-sync-state.json');
  if (initialData) fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2), 'utf8');
  const applied = [];
  const engine = new FolderSyncEngine({
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
    onApplied: function (data) { applied.push(data); },
    log: function () {}
  });
  return { engine: engine, dataFile: dataFile, applied: applied };
}

function readData(device) {
  return JSON.parse(fs.readFileSync(device.dataFile, 'utf8'));
}

test('两台设备：推、加入、增、删全流程收敛，密钥不上传', async function (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rixu-folder-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  const shared = path.join(root, 'OneDrive', '日序');
  const A = makeDevice(path.join(root, 'device-a'), seedData());
  const B = makeDevice(path.join(root, 'device-b'), {
    version: 1, events: [], sources: [], inbox: [], templates: [], series: [],
    settings: { captureEnabled: false, llm: { enabled: false, apiKey: '' }, napcat: { enabled: false, token: '' } },
    meta: { onboarded: true, hashes: [], notified: {} }
  });

  // A 首次配置：本地数据全量写进快照
  const cfgA = await A.engine.configure(shared);
  assert.strictEqual(cfgA.ok, true, cfgA.error);
  assert.ok(cfgA.sync && cfgA.sync.ok, cfgA.sync && cfgA.sync.error);
  const firstFile = path.join(shared, fc.SNAPSHOT_FILE);
  assert.ok(fs.existsSync(firstFile), '应写出 rixu-sync.json');
  const firstText = fs.readFileSync(firstFile, 'utf8');
  assert.ok(!/sk-should-never-upload/.test(firstText), 'API Key 不能写进同步文件');
  assert.ok(!/napcat-should-never-upload/.test(firstText), 'NapCat Token 不能写进同步文件');
  assert.strictEqual(A.engine.status().configured, true);
  assert.ok(A.engine.status().calendarId);

  // B 指向同一文件夹：需要确认加入
  const needJoin = await B.engine.configure(shared);
  assert.strictEqual(needJoin.ok, false);
  assert.strictEqual(needJoin.needsJoin, true);
  assert.strictEqual(B.engine.status().enabled, false, '未确认加入前不应启用');

  const joinB = await B.engine.configure(shared, { join: true });
  assert.strictEqual(joinB.ok, true, joinB.error);
  assert.ok(joinB.sync && joinB.sync.ok, joinB.sync && joinB.sync.error);
  const dataB = readData(B);
  assert.strictEqual(dataB.events.length, 1);
  assert.strictEqual(dataB.events[0].title, '组会');
  assert.strictEqual(dataB.templates.length, 1, '模板也要同步');
  assert.strictEqual(dataB.settings.llm.apiKey || '', '', '密钥不该从同步文件带下来');
  assert.strictEqual(dataB.settings.napcat.token || '', '', 'Token 不该从同步文件带下来');

  // B 新增，A 能收到
  dataB.events.push({ id: 'evt_b', title: '交作业', start: '2026-11-06T09:00', end: '2026-11-06T10:00' });
  fs.writeFileSync(B.dataFile, JSON.stringify(dataB, null, 2), 'utf8');
  const pushB = await B.engine.syncNow('test');
  assert.strictEqual(pushB.ok, true, pushB.error);
  const pullA = await A.engine.syncNow('test');
  assert.strictEqual(pullA.ok, true, pullA.error);
  const dataA = readData(A);
  assert.strictEqual(dataA.events.length, 2);
  assert.ok(dataA.events.some(function (e) { return e.id === 'evt_b'; }));

  // A 删除，B 也要删
  dataA.events = dataA.events.filter(function (e) { return e.id !== 'evt_a'; });
  fs.writeFileSync(A.dataFile, JSON.stringify(dataA, null, 2), 'utf8');
  const delA = await A.engine.syncNow('test');
  assert.strictEqual(delA.ok, true, delA.error);
  const pullB = await B.engine.syncNow('test');
  assert.strictEqual(pullB.ok, true, pullB.error);
  const dataB2 = readData(B);
  assert.strictEqual(dataB2.events.length, 1);
  assert.strictEqual(dataB2.events[0].id, 'evt_b');
});

test('冲突副本会被合并，并改名成 .merged', async function (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rixu-folder-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  const shared = path.join(root, 'sync');
  const A = makeDevice(path.join(root, 'device-a'), seedData());
  const cfgA = await A.engine.configure(shared);
  assert.strictEqual(cfgA.ok, true, cfgA.error);
  const calendarId = A.engine.status().calendarId;

  const conflict = path.join(shared, 'rixu-sync-DESKTOP-ABC.json');
  fs.writeFileSync(conflict, JSON.stringify(fc.makeSnapshot(calendarId, [{
    kind: 'event',
    id: 'evt_conflict',
    payload: { id: 'evt_conflict', title: '冲突副本里的日程', start: '2026-11-08T09:00', end: '2026-11-08T10:00' },
    updated_at: '2026-11-08T00:00:00.000Z',
    deleted: false
  }], { device: 'OTHER', updatedAt: '2026-11-08T00:00:00.000Z' }), null, 2), 'utf8');

  const sync = await A.engine.syncNow('test');
  assert.strictEqual(sync.ok, true, sync.error);
  assert.ok(sync.summary.conflicts >= 1, '应合并并改名冲突副本');
  assert.ok(!fs.existsSync(conflict), '冲突副本应被改名');
  assert.ok(fs.existsSync(conflict + '.merged'), '改名后保留内容');
  const dataA = readData(A);
  assert.ok(dataA.events.some(function (e) { return e.id === 'evt_conflict'; }));
});

test('过期设备写回旧版本，不会复活已删除日程', async function (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rixu-folder-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  const shared = path.join(root, 'sync');
  const A = makeDevice(path.join(root, 'device-a'), seedData());
  await A.engine.configure(shared);
  const calendarId = A.engine.status().calendarId;

  const dataA = readData(A);
  dataA.events = [];
  fs.writeFileSync(A.dataFile, JSON.stringify(dataA, null, 2), 'utf8');
  const del = await A.engine.syncNow('test');
  assert.strictEqual(del.ok, true, del.error);

  // 模拟另一台还没看到删除的设备，写回旧事件
  const stale = path.join(shared, 'rixu-sync-LAPTOP-OLD.json');
  fs.writeFileSync(stale, JSON.stringify(fc.makeSnapshot(calendarId, [{
    kind: 'event',
    id: 'evt_a',
    payload: { id: 'evt_a', title: '组会', start: '2026-11-02T10:00', end: '2026-11-02T11:00' },
    updated_at: '2026-10-30T00:00:00.000Z',
    deleted: false
  }], { device: 'OLD' }), null, 2), 'utf8');

  const sync = await A.engine.syncNow('test');
  assert.strictEqual(sync.ok, true, sync.error);
  const after = readData(A);
  assert.strictEqual(after.events.length, 0, '旧版本不应复活已删日程');

  const main = JSON.parse(fs.readFileSync(path.join(shared, fc.SNAPSHOT_FILE), 'utf8'));
  const item = main.items['event:evt_a'];
  assert.ok(item, '快照里应保留墓碑');
  assert.strictEqual(item.deleted, true);
});

test('没有改动时不重写同步文件，避免云盘空转和冲突', async function (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rixu-folder-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  const shared = path.join(root, 'sync');
  const A = makeDevice(path.join(root, 'device-a'), seedData());
  await A.engine.configure(shared);
  const file = path.join(shared, fc.SNAPSHOT_FILE);
  const before = fs.readFileSync(file, 'utf8');

  const sync = await A.engine.syncNow('test');
  assert.strictEqual(sync.ok, true, sync.error);
  assert.strictEqual(sync.summary.wrote, false, '没有改动时不应写文件');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, '文件内容不应变化');
});

test('新设备首次同步不会删除云端数据', async function (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rixu-folder-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  const shared = path.join(root, 'sync');
  const A = makeDevice(path.join(root, 'device-a'), seedData());
  await A.engine.configure(shared);

  const C = makeDevice(path.join(root, 'device-c'), {
    version: 1, events: [], sources: [], inbox: [], templates: [], series: [],
    settings: { captureEnabled: false, llm: { enabled: false, apiKey: '' }, napcat: { enabled: false, token: '' } },
    meta: { onboarded: true, hashes: [], notified: {} }
  });
  const join = await C.engine.configure(shared, { join: true });
  assert.strictEqual(join.ok, true, join.error);
  await C.engine.syncNow('test');

  const main = JSON.parse(fs.readFileSync(path.join(shared, fc.SNAPSHOT_FILE), 'utf8'));
  assert.ok(main.items['event:evt_a'], '新设备不应把云端日程删掉');
  assert.strictEqual(main.items['event:evt_a'].deleted, false);
});
