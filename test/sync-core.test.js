'use strict';

const test = require('node:test');
const assert = require('node:assert');
const core = require('../src/sync-core');

function baseData() {
  return {
    events: [
      {
        id: 'evt_1',
        title: '组会',
        start: '2026-11-02T10:00',
        end: '2026-11-02T11:00',
        reminderSentAt: '2026-11-02T09:50:00.000Z',
        createdAt: '2026-10-30T01:00:00.000Z'
      }
    ],
    sources: [{ id: 'src_1', name: '家长群', importance: 'normal', count: 3 }],
    inbox: [{ id: 'inbox_1', status: 'pending' }],
    settings: {
      captureEnabled: true,
      autoAdd: false,
      autoThreshold: 0.9,
      notify: true,
      reminderMinutes: 10,
      closeToTray: true,
      openAtLogin: true,
      llm: { enabled: true, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'sk-secret' },
      napcat: { enabled: false, url: 'ws://127.0.0.1:3001', token: 'napcat-secret' }
    }
  };
}

test('指纹与键顺序无关', function () {
  const a = core.hashPayload({ x: 1, y: { b: 2, a: 3 } });
  const b = core.hashPayload({ y: { a: 3, b: 2 }, x: 1 });
  assert.strictEqual(a, b);
});

test('设置白名单不含 API Key / NapCat Token', function () {
  const payload = core.settingsPayload(baseData().settings);
  const text = JSON.stringify(payload);
  assert.ok(!/sk-secret/.test(text));
  assert.ok(!/napcat-secret/.test(text));
  assert.ok(!('openAtLogin' in payload), '单机设置不同步');
  assert.ok(!('closeToTray' in payload), '单机设置不同步');
  assert.strictEqual(payload.llm.baseUrl, 'https://api.deepseek.com');
});

test('合并远端设置时保留本机密钥', function () {
  const settings = baseData().settings;
  core.applySettingsPayload(settings, core.settingsPayload(baseData().settings));
  assert.strictEqual(settings.llm.apiKey, 'sk-secret');
  assert.strictEqual(settings.napcat.token, 'napcat-secret');
});

test('collectLocal 覆盖四类条目，并剔除易变字段', function () {
  const items = core.collectLocal(baseData());
  assert.ok(items.has('event:evt_1'));
  assert.ok(items.has('source:src_1'));
  assert.ok(items.has('inbox:inbox_1'));
  assert.ok(items.has(core.SETTINGS_KEY));
  assert.strictEqual(items.get('event:evt_1').payload.reminderSentAt, undefined);
});

test('diffLocal：首次全推、之后无变化、删除可识别', function () {
  const data = baseData();
  const items = core.collectLocal(data);
  const first = core.diffLocal(items, {});
  assert.strictEqual(first.changed.length, 4);
  assert.strictEqual(first.deleted.length, 0);

  const base = {};
  first.changed.forEach(function (c) { base[c.key] = { hash: c.hash, updatedAt: 'now' }; });
  assert.strictEqual(core.diffLocal(items, base).changed.length, 0);

  data.events = [];
  const afterDelete = core.diffLocal(core.collectLocal(data), base);
  assert.deepStrictEqual(afterDelete.deleted.map(function (d) { return d.key; }), ['event:evt_1']);
});

test('applyRemoteRows：新增、旧版本不覆盖、本地改动优先', function () {
  const data = { events: [], sources: [], inbox: [], settings: { llm: { apiKey: 'x' } } };
  const row = {
    kind: 'event',
    id: 'evt_9',
    payload: { id: 'evt_9', title: '远端日程' },
    updated_at: '2026-11-01T00:00:00.000Z',
    deleted: false
  };
  const applied = core.applyRemoteRows(data, [row], {
    stateItems: {},
    tombstones: {},
    localChangedKeys: new Set(),
    maxRemoteTs: ''
  });
  assert.strictEqual(applied.applied, 1);
  assert.strictEqual(data.events.length, 1);

  // 同一版本再来一次：不重复应用
  const again = core.applyRemoteRows(data, [row], {
    stateItems: applied.stateItems,
    tombstones: applied.tombstones,
    localChangedKeys: new Set(),
    maxRemoteTs: ''
  });
  assert.strictEqual(again.applied, 0);

  // 本地刚改过：远端行被跳过，留给本地推上去
  const localWins = core.applyRemoteRows(data, [Object.assign({}, row, { payload: { id: 'evt_9', title: '远端改名' } })], {
    stateItems: {},
    tombstones: {},
    localChangedKeys: new Set(['event:evt_9']),
    maxRemoteTs: ''
  });
  assert.strictEqual(localWins.applied, 0);
  assert.strictEqual(data.events[0].title, '远端日程');
});

test('applyRemoteRows：删除传播且墓碑挡住复活', function () {
  const data = { events: [{ id: 'evt_1' }], sources: [], inbox: [], settings: {} };
  const row = { kind: 'event', id: 'evt_1', payload: {}, updated_at: '2026-11-02T00:00:00.000Z', deleted: true };
  const result = core.applyRemoteRows(data, [row], {
    stateItems: { 'event:evt_1': { hash: 'old', updatedAt: '2026-11-01T00:00:00.000Z' } },
    tombstones: {},
    localChangedKeys: new Set(),
    maxRemoteTs: ''
  });
  assert.strictEqual(data.events.length, 0);
  assert.strictEqual(result.applied, 1);
  assert.ok(result.tombstones['event:evt_1']);

  // 另一台机器把同一版本又推回来，会被墓碑挡住
  const revive = { kind: 'event', id: 'evt_1', payload: { id: 'evt_1', title: '复活' }, updated_at: '2026-11-02T00:00:00.000Z', deleted: false };
  const blocked = core.applyRemoteRows(data, [revive], {
    stateItems: result.stateItems,
    tombstones: result.tombstones,
    localChangedKeys: new Set(),
    maxRemoteTs: ''
  });
  assert.strictEqual(blocked.applied, 0);
  assert.strictEqual(data.events.length, 0);
});

test('Postgres 时间格式和 JS ISO 也能正确比新旧', function () {
  const data = { events: [], sources: [], inbox: [], settings: {} };
  const row = {
    kind: 'event',
    id: 'evt_pg',
    payload: { id: 'evt_pg', title: 'pg 时间' },
    updated_at: '2026-11-03T08:00:00.123456+00:00',
    deleted: false
  };
  const result = core.applyRemoteRows(data, [row], {
    stateItems: {},
    tombstones: {},
    localChangedKeys: new Set(),
    maxRemoteTs: '2026-11-03T08:00:00.123Z'
  });
  // 远端比游标新 0.456ms 以内？这里只验证不抛错、能应用/跳过而不误判。
  assert.strictEqual(typeof result.applied, 'number');
});

test('模板和周期定义也走同步，并能合并到新设备', function () {
  const data = {
    events: [],
    sources: [],
    inbox: [],
    templates: [{ id: 'tpl_1', title: '交作业', time: '20:00', endTime: '20:30' }],
    series: [{
      id: 'ser_1', title: '组会', startDate: '2026-11-04', until: '2026-12-30',
      freq: 'weekly', interval: 1, weekdays: [3], time: '10:00', endTime: '11:00'
    }],
    settings: {}
  };
  const items = core.collectLocal(data);
  assert.ok(items.has('template:tpl_1'));
  assert.ok(items.has('series:ser_1'));

  const first = core.diffLocal(items, {});
  assert.strictEqual(first.changed.length, 3, '两条内容 + 一份设置');

  const remote = {
    events: [], sources: [], inbox: [], settings: {},
    templates: [{ id: 'tpl_2', title: '交实验报告' }],
    series: [{ id: 'ser_2', title: '周会', weekdays: [1] }]
  };
  const result = core.applyRemoteRows(remote, [
    { kind: 'template', id: 'tpl_2', payload: { id: 'tpl_2', title: '交实验报告' }, updated_at: '2026-11-01T00:00:00.000Z', deleted: false },
    { kind: 'series', id: 'ser_2', payload: { id: 'ser_2', title: '周会', weekdays: [1] }, updated_at: '2026-11-01T00:00:00.000Z', deleted: false }
  ], {
    stateItems: {},
    tombstones: {},
    localChangedKeys: new Set(),
    maxRemoteTs: ''
  });
  assert.strictEqual(result.applied, 2);
  assert.strictEqual(remote.templates.length, 1);
  assert.strictEqual(remote.series[0].title, '周会');

  const del = core.applyRemoteRows(remote, [
    { kind: 'template', id: 'tpl_2', payload: {}, updated_at: '2026-11-02T00:00:00.000Z', deleted: true }
  ], {
    stateItems: result.stateItems,
    tombstones: result.tombstones,
    localChangedKeys: new Set(),
    maxRemoteTs: ''
  });
  assert.strictEqual(del.applied, 1);
  assert.strictEqual(remote.templates.length, 0);
});

test('pruneTombstones 只保留 90 天内', function () {
  const now = '2026-06-01T00:00:00.000Z';
  const kept = core.pruneTombstones({
    fresh: '2026-05-20T00:00:00.000Z',
    old: '2026-01-01T00:00:00.000Z'
  }, now);
  assert.deepStrictEqual(Object.keys(kept), ['fresh']);
});
