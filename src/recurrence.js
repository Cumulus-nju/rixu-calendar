/*
 * 日序 · 周期日程展开
 *
 * 只做纯计算：给一个周期定义，算出「哪几天有这件事」。
 * 不依赖 Electron、不联网、不碰 DOM，主进程 / 渲染层 / 单测都能用。
 *
 * 约定：
 * - 周期本身只存一份定义（data.series），真正进日历的是展开后的一条条日程；
 * - 展开结果按 ISO 日期升序，已排除 exceptions（用户单独删掉的那几次）；
 * - 最多展开 200 次、跨度最长两年，防止误填把数据撑爆。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RixuRecurrence = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_OCCURRENCES = 200;
  var MAX_RANGE_DAYS = 731;
  var WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  // 中文习惯从周一开始；0 = 周日。
  var WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var day = Number(m[3]);
    var d = new Date(y, mo - 1, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
    return d;
  }

  function dayNumber(d) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  function daysBetween(a, b) {
    return dayNumber(b) - dayNumber(a);
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function isTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
  }

  function sortWeekdays(list) {
    var seen = [];
    (Array.isArray(list) ? list : []).forEach(function (value) {
      var n = Number(value);
      if (n >= 0 && n <= 6 && seen.indexOf(n) < 0) seen.push(n);
    });
    return WEEKDAY_ORDER.filter(function (value) { return seen.indexOf(value) >= 0; });
  }

  function normalizeSeries(input) {
    var raw = input || {};
    var startDate = String(raw.startDate || '').slice(0, 10);
    var until = String(raw.until || '').slice(0, 10);
    var freq = raw.freq === 'daily' ? 'daily' : 'weekly';
    var interval = Math.max(1, Math.min(4, parseInt(raw.interval, 10) || 1));
    var exceptions = [];
    (Array.isArray(raw.exceptions) ? raw.exceptions : []).forEach(function (key) {
      var k = String(key || '').slice(0, 10);
      if (parseKey(k) && exceptions.indexOf(k) < 0) exceptions.push(k);
    });
    var weekdays = freq === 'weekly' ? sortWeekdays(raw.weekdays) : [];
    return {
      id: String(raw.id || ''),
      title: String(raw.title || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      startDate: parseKey(startDate) ? startDate : '',
      until: parseKey(until) ? until : '',
      freq: freq,
      interval: interval,
      weekdays: weekdays,
      allDay: !!raw.allDay,
      time: isTime(raw.time) ? raw.time : '09:00',
      endTime: isTime(raw.endTime) ? raw.endTime : '10:00',
      location: String(raw.location || '').trim().slice(0, 60),
      note: String(raw.note || '').trim().slice(0, 200),
      sourceId: String(raw.sourceId || ''),
      exceptions: exceptions,
      createdAt: String(raw.createdAt || '')
    };
  }

  function expandAll(series) {
    var s = normalizeSeries(series);
    var start = parseKey(s.startDate);
    var until = parseKey(s.until);
    if (!start || !until) return { dates: [], truncated: false, tooLong: false };

    var span = daysBetween(start, until);
    if (span < 0) return { dates: [], truncated: false, tooLong: false };
    if (span > MAX_RANGE_DAYS) return { dates: [], truncated: true, tooLong: true };

    var out = [];
    var truncated = false;

    if (s.freq === 'daily') {
      for (var d = start; daysBetween(d, until) >= 0; d = addDays(d, s.interval)) {
        if (out.length >= MAX_OCCURRENCES) { truncated = true; break; }
        out.push(dateKey(d));
      }
    } else {
      var week = addDays(start, -start.getDay());
      var guard = 0;
      while (daysBetween(week, until) >= 0 && guard < 800) {
        for (var i = 0; i < s.weekdays.length; i++) {
          var candidate = addDays(week, s.weekdays[i]);
          if (daysBetween(start, candidate) < 0) continue;
          if (daysBetween(candidate, until) < 0) continue;
          if (out.length >= MAX_OCCURRENCES) { truncated = true; break; }
          out.push(dateKey(candidate));
        }
        if (truncated) break;
        week = addDays(week, 7 * s.interval);
        guard += 1;
      }
    }

    out.sort();
    var exceptions = s.exceptions;
    var dates = [];
    for (var j = 0; j < out.length; j++) {
      if (exceptions.indexOf(out[j]) < 0 && dates.indexOf(out[j]) < 0) dates.push(out[j]);
    }
    return { dates: dates, truncated: truncated, tooLong: false };
  }

  function expandSeries(series) {
    return expandAll(series).dates;
  }

  function validateSeries(series) {
    var s = normalizeSeries(series);
    if (!s.title) return { ok: false, error: '给这个周期一个标题。' };
    if (!s.startDate) return { ok: false, error: '开始日期不对。' };
    if (!s.until) return { ok: false, error: '选一个结束日期。' };
    if (daysBetween(parseKey(s.startDate), parseKey(s.until)) < 0) {
      return { ok: false, error: '结束日期不能早于开始日期。' };
    }
    if (s.freq === 'weekly' && !s.weekdays.length) {
      return { ok: false, error: '至少选一个星期几。' };
    }
    var result = expandAll(s);
    if (result.tooLong) return { ok: false, error: '周期最长两年，把结束日期改近一点。' };
    if (result.truncated) return { ok: false, error: '重复次数太多（最多 ' + MAX_OCCURRENCES + ' 次），把结束日期改近一点。' };
    if (!result.dates.length) return { ok: false, error: '这个周期里没有任何一天，检查开始日期和星期。' };
    return { ok: true, series: s, dates: result.dates };
  }

  function describeFrequency(series) {
    var s = normalizeSeries(series);
    if (s.freq === 'daily') return s.interval === 1 ? '每天' : '每 ' + s.interval + ' 天';
    if (s.interval === 1) return '每周';
    if (s.interval === 2) return '每两周';
    return '每 ' + s.interval + ' 周';
  }

  function weekdayText(series) {
    var s = normalizeSeries(series);
    return s.weekdays.map(function (value) { return WEEKDAY_SHORT[value]; }).join('、');
  }

  return {
    MAX_OCCURRENCES: MAX_OCCURRENCES,
    MAX_RANGE_DAYS: MAX_RANGE_DAYS,
    WEEKDAY_SHORT: WEEKDAY_SHORT,
    dateKey: dateKey,
    parseKey: parseKey,
    addDays: addDays,
    daysBetween: daysBetween,
    sortWeekdays: sortWeekdays,
    normalizeSeries: normalizeSeries,
    expandSeries: expandSeries,
    validateSeries: validateSeries,
    describeFrequency: describeFrequency,
    weekdayText: weekdayText
  };
});
