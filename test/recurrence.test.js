'use strict';

const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/recurrence');

function weekly(overrides) {
  return Object.assign({
    title: '组会',
    startDate: '2026-11-02',
    until: '2026-11-15',
    freq: 'weekly',
    interval: 1,
    weekdays: [1, 3],
    allDay: false,
    time: '10:00',
    endTime: '11:00'
  }, overrides || {});
}

test('每周一、三：从周一开始，含两端', function () {
  const dates = R.expandSeries(weekly());
  assert.deepStrictEqual(dates, ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);
});

test('每两周只取间隔周', function () {
  const dates = R.expandSeries(weekly({ startDate: '2026-11-04', until: '2026-12-02', weekdays: [3], interval: 2 }));
  assert.deepStrictEqual(dates, ['2026-11-04', '2026-11-18', '2026-12-02']);
});

test('初始周里早于开始日期的星期会被跳过', function () {
  const dates = R.expandSeries(weekly({ startDate: '2026-11-04', until: '2026-11-15', weekdays: [1, 3] }));
  assert.deepStrictEqual(dates, ['2026-11-04', '2026-11-09', '2026-11-11']);
});

test('exceptions 会从展开结果里剔除', function () {
  const dates = R.expandSeries(weekly({ exceptions: ['2026-11-04', '2026-11-11'] }));
  assert.deepStrictEqual(dates, ['2026-11-02', '2026-11-09']);
});

test('每天 / 每两天', function () {
  assert.deepStrictEqual(
    R.expandSeries({ title: 'x', startDate: '2026-11-02', until: '2026-11-05', freq: 'daily', interval: 1 }),
    ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']
  );
  assert.deepStrictEqual(
    R.expandSeries({ title: 'x', startDate: '2026-11-02', until: '2026-11-06', freq: 'daily', interval: 2 }),
    ['2026-11-02', '2026-11-04', '2026-11-06']
  );
});

test('校验：缺星期、倒序、超两年、次数过多', function () {
  assert.strictEqual(R.validateSeries(weekly({ weekdays: [] })).ok, false);
  assert.strictEqual(R.validateSeries(weekly({ startDate: '2026-11-10', until: '2026-11-01' })).ok, false);
  assert.strictEqual(R.validateSeries(weekly({ until: '2029-12-31' })).ok, false);
  assert.strictEqual(R.validateSeries({ title: 'x', startDate: '2026-01-01', until: '2026-12-31', freq: 'daily' }).ok, false);
});

test('校验：正常周期返回展开日期', function () {
  const result = R.validateSeries(weekly());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dates.length, 4);
});

test('描述文字', function () {
  assert.strictEqual(R.describeFrequency(weekly()), '每周');
  assert.strictEqual(R.describeFrequency(weekly({ interval: 2 })), '每两周');
  assert.strictEqual(R.describeFrequency(weekly({ freq: 'daily', interval: 1 })), '每天');
  assert.strictEqual(R.weekdayText(weekly()), '周一、周三');
});
