'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fc = require('../src/folder-sync-core');

function row(overrides) {
  return Object.assign({
    kind: 'event',
    id: 'evt_1',
    payload: { id: 'evt_1', title: '组会' },
    updated_at: '2026-11-01T00:00:00.000Z',
    deleted: false
  }, overrides || {});
}

function snapshot(calendarId, rows) {
  const items = {};
  rows.forEach((r) => { items[r.kind + ':' + r.id] = r; });
  return { app: 'rixu-calendar', schema: 1, calendarId: calendarId, items: items };
}

test('文件名识别：主文件、云盘冲突副本，排除 .merged', function () {
  assert.strictEqual(fc.isSnapshotFile('rixu-sync.json'), true);
  assert.strictEqual(fc.isSnapshotFile('rixu-sync (1).json'), true);
  assert.strictEqual(fc.isSnapshotFile('rixu-sync-DESKTOP-ABC.json'), true);
  assert.strictEqual(fc.isSnapshotFile('rixu-sync.json.merged'), false);
  assert.strictEqual(fc.isSnapshotFile('other.json'), false);
});

test('多份快照合并：同一条取更新时间新的', function () {
  const older = row({ updated_at: '2026-11-01T00:00:00.000Z', payload: { id: 'evt_1', title: '旧标题' } });
  const newer = row({ updated_at: '2026-11-02T00:00:00.000Z', payload: { id: 'evt_1', title: '新标题' } });
  const merged = fc.mergeSnapshots([
    { name: 'rixu-sync.json', data: snapshot('cal-1', [older]) },
    { name: 'rixu-sync (1).json', data: snapshot('cal-1', [newer]) }
  ]);
  assert.strictEqual(merged.ok, true);
  assert.strictEqual(merged.calendarId, 'cal-1');
  assert.strictEqual(merged.rows.length, 1);
  assert.strictEqual(merged.rows[0].payload.title, '新标题');
});

test('同一毫秒里墓碑优先，避免复活', function () {
  const live = row({ updated_at: '2026-11-02T00:00:00.000Z', deleted: false });
  const dead = row({ updated_at: '2026-11-02T00:00:00.000Z', deleted: true, payload: {} });
  const merged = fc.mergeSnapshots([
    { name: 'a.json', data: snapshot('cal-1', [live]) },
    { name: 'b.json', data: snapshot('cal-1', [dead]) }
  ]);
  assert.strictEqual(merged.rows[0].deleted, true);
});

test('不同 calendarId 的多份快照拒绝合并', function () {
  const merged = fc.mergeSnapshots([
    { name: 'a.json', data: snapshot('cal-1', [row()]) },
    { name: 'b.json', data: snapshot('cal-2', [row({ id: 'evt_2' })]) }
  ]);
  assert.strictEqual(merged.ok, false);
  assert.ok(/多个不同的日序日历/.test(merged.error));
});

test('坏文件跳过并给 warning，不影响好文件', function () {
  const merged = fc.mergeSnapshots([
    { name: 'bad.json', data: { hello: 'world' } },
    { name: 'rixu-sync.json', data: snapshot('cal-1', [row()]) }
  ]);
  assert.strictEqual(merged.ok, true);
  assert.strictEqual(merged.rows.length, 1);
  assert.strictEqual(merged.warnings.length, 1);
});

test('makeSnapshot 输出可直接被 parse / merge 读回', function () {
  const snap = fc.makeSnapshot('cal-1', [row(), row({ kind: 'template', id: 'tpl_1', payload: { id: 'tpl_1', title: '交作业' } })], {
    device: 'PC-A',
    updatedAt: '2026-11-03T00:00:00.000Z'
  });
  assert.strictEqual(snap.device, 'PC-A');
  assert.strictEqual(Object.keys(snap.items).length, 2);
  const parsed = fc.parseSnapshot('rixu-sync.json', snap);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.rows.length, 2);
  const merged = fc.mergeSnapshots([{ name: 'rixu-sync.json', data: snap }]);
  assert.strictEqual(merged.ok, true);
  assert.strictEqual(merged.calendarId, 'cal-1');
});
