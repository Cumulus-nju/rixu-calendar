/*
 * 日序 · 本地中文日程解析器
 * 无依赖，可同时运行在 Electron 主进程与浏览器。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RixuParser = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CN_DIGIT = {
    '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9
  };

  var WEEKDAY = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
  };

  var EVENT_RULES = [
    { key: '交作业', re: /(?:交|提交|上交|完成|写)(?:[\u4e00-\u9fa5A-Za-z0-9]{0,10}?(?:作业|报告|材料|论文|表格|文件))/g, strong: true, duration: 30, deadline: true },
    { key: '报名', re: /(?:报名(?:参加)?[\u4e00-\u9fa5A-Za-z0-9]{0,12}|报名截止)/g, strong: true, duration: 30, deadline: true },
    { key: '截止', re: /(?:截止|截止日期|最后期限)/g, strong: true, duration: 30, deadline: true },
    { key: '家长会', re: /家长会/g, strong: true, duration: 90 },
    { key: '班会', re: /班会/g, strong: true, duration: 60 },
    { key: '例会', re: /例会/g, strong: true, duration: 60 },
    { key: '开会', re: /(?:开会|开个会|碰头会|碰头)/g, strong: true, duration: 60 },
    { key: '会议', re: /(?:会议(?!室)|教研会|年级会|组会|周会|晨会)/g, strong: true, duration: 60 },
    { key: '考试', re: /(?:考试|补考|测验|模拟考|期中|期末考)/g, strong: true, duration: 120 },
    { key: '答辩', re: /(?:答辩|开题)/g, strong: true, duration: 90 },
    { key: '面试', re: /(?:面试|复试|初试)/g, strong: true, duration: 45 },
    { key: '体检', re: /(?:体检|体测)/g, strong: true, duration: 120 },
    { key: '讲座', re: /(?:讲座|报告会|分享会|宣讲会|学术报告|论坛|沙龙|研讨会|座谈|交流会|读书会|党课|团课)/g, strong: true, duration: 90 },
    { key: '培训', re: /(?:培训|课程|上课|听课)/g, strong: true, duration: 90 },
    { key: '比赛', re: /(?:比赛|竞赛|决赛|初赛|运动会)/g, strong: true, duration: 120 },
    { key: '典礼', re: /(?:典礼|仪式|升旗|开学式|毕业式)/g, strong: true, duration: 60 },
    { key: '集合', re: /(?:集合|到校|返校|报到)/g, strong: true, duration: 60 },
    { key: '活动', re: /(?:活动|社团|志愿|参观|出游|团建)/g, strong: false, duration: 120 },
    { key: '聚会', re: /(?:聚会|聚餐|饭局|约饭|生日会)/g, strong: false, duration: 120 },
    { key: '见面', re: /(?:见面|碰面|见个面|老地方见)/g, strong: false, duration: 60 },
    { key: '排练', re: /(?:排练|彩排|演出|表演)/g, strong: false, duration: 90 },
    { key: '值日', re: /(?:值日|值班|查寝)/g, strong: false, duration: 30 },
    { key: '缴费', re: /(?:缴费|交费|付费|交钱)/g, strong: false, duration: 30, deadline: true },
    { key: '领取', re: /(?:领取|领书|领材料|拿资料)/g, strong: false, duration: 30 }
  ];

  var STOP_WORDS = /^(?:请|通知|记得|大家|同学们?|老师|我们|你们|要|去|来|在|到|于|和|与|跟|给|准时|一起|统一|安排|组织|临时|今天|明天|后天|大后天|上午|下午|中午|晚上|早上|凌晨|本周|这周|下周|周[一二三四五六日天]|星期[一二三四五六日天])/;

  function normalizeText(input) {
    return String(input == null ? '' : input)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ')
      .replace(/_{2,}/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }

  function cnToNumber(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === '十') return 10;
    if (s.indexOf('十') >= 0) {
      var parts = s.split('十');
      var tens = parts[0] ? (CN_DIGIT[parts[0]] == null ? 0 : CN_DIGIT[parts[0]]) : 1;
      var ones = parts[1] ? (CN_DIGIT[parts[1]] == null ? 0 : CN_DIGIT[parts[1]]) : 0;
      return tens * 10 + ones;
    }
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      if (CN_DIGIT[s[i]] == null) return NaN;
      n = n * 10 + CN_DIGIT[s[i]];
    }
    return n;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  function shiftDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function makeDate(y, m, d, hh, mm) {
    var x = new Date(y, m - 1, d, hh == null ? 0 : hh, mm == null ? 0 : mm, 0, 0);
    if (x.getFullYear() !== y || x.getMonth() !== m - 1 || x.getDate() !== d) return null;
    return x;
  }

  function localISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function timeKey(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function parseDate(text, now) {
    var today = startOfDay(now);
    var m, date = null, explicit = true, phrase = '', periodHint = null, relativeKind = null;

    if ((m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/))) {
      var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), da = parseInt(m[3], 10);
      date = makeDate(y, mo, da);
      if (date) phrase = m[0];
    } else if ((m = text.match(/(下个?月|本月|这个月|当月)\s*(\d{1,2})\s*[日号]/))) {
      mo = now.getMonth() + 1;
      if (m[1].indexOf('下') === 0) mo += 1;
      da = parseInt(m[2], 10);
      if (mo > 12) { mo -= 12; y = now.getFullYear() + 1; } else { y = now.getFullYear(); }
      date = makeDate(y, mo, da);
      if (date) phrase = m[0];
    } else if ((m = text.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/))) {
      y = parseInt(m[1], 10); mo = parseInt(m[2], 10); da = parseInt(m[3], 10);
      date = makeDate(y, mo, da);
      if (date) phrase = m[0];
    } else if ((m = text.match(/(\d{1,2})[./](\d{1,2})(?!\d)/))) {
      mo = parseInt(m[1], 10); da = parseInt(m[2], 10);
      y = now.getFullYear();
      date = makeDate(y, mo, da);
      if (date && date < today) {
        var dotPassDays = Math.round((today - date) / 86400000);
        if (dotPassDays > 2) date = makeDate(y + 1, mo, da);
      }
      if (date) phrase = m[0];
    } else if ((m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/))) {
      mo = parseInt(m[1], 10); da = parseInt(m[2], 10);
      y = now.getFullYear();
      date = makeDate(y, mo, da);
      if (date && date < today) {
        var passDays = Math.round((today - date) / 86400000);
        if (passDays > 2) date = makeDate(y + 1, mo, da);
      }
      if (date) phrase = m[0];
    } else if ((m = text.match(/(大后天|大后日|后天|明晚|明日|明天|今晚|今日|今天|后晚)/))) {
      var word = m[1];
      phrase = word;
      relativeKind = 'relative';
      if (word.indexOf('大后') === 0) { date = addDays(today, 3); }
      else if (word === '后晚') { date = addDays(today, 2); periodHint = '晚上'; }
      else if (word.indexOf('后') === 0) { date = addDays(today, 2); }
      else if (word.indexOf('明') === 0) { date = addDays(today, 1); if (word === '明晚') periodHint = '晚上'; }
      else { date = today; if (word === '今晚') periodHint = '晚上'; }
    } else if ((m = text.match(/([一二三四五六七八九十两\d]{1,3})\s*天\s*(?:后|以后|之后)/))) {
      var nDays = cnToNumber(m[1]);
      if (!isNaN(nDays)) {
        date = addDays(today, nDays);
        phrase = m[0];
        relativeKind = 'relative';
      }
    } else if ((m = text.match(/(?:(这|本|下下|下)\s*)?(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/))) {
      var prefix = m[1] || '';
      var target = WEEKDAY[m[2]];
      var monday = addDays(today, -((today.getDay() + 6) % 7));
      var candidate = addDays(monday, target - 1);
      if (prefix === '下下') candidate = addDays(candidate, 14);
      else if (prefix === '下') candidate = addDays(candidate, 7);
      else if (prefix === '这' || prefix === '本') {
        if (candidate < today) candidate = addDays(candidate, 7);
      } else {
        if (candidate < today) candidate = addDays(candidate, 7);
      }
      date = candidate;
      phrase = m[0];
      relativeKind = 'weekday';
    } else if ((m = text.match(/(?:这个?)?周末/))) {
      var sat = addDays(today, -((today.getDay() + 6) % 7) + 5);
      if (sat < today) sat = addDays(sat, 7);
      date = sat; phrase = m[0]; relativeKind = 'weekday';
    } else if ((m = text.match(/(\d{1,2})\s*[日号](?!\s*(?:楼|室|门|院|床|桌|口|线|站|车))/))) {
      da = parseInt(m[1], 10);
      if (da >= 1 && da <= 31) {
        var cand = makeDate(now.getFullYear(), now.getMonth() + 1, da);
        if (cand && cand < today) cand = makeDate(now.getFullYear(), now.getMonth() + 2, da);
        date = cand;
        if (date) phrase = m[0];
      }
    } else if ((m = text.match(/(\d{1,2})\s*天\s*(?:后|以后|之后)/))) {
      date = addDays(today, parseInt(m[1], 10));
      phrase = m[0];
      relativeKind = 'relative';
    }
    if (!date) return null;
    return {
      date: date,
      explicit: explicit,
      phrase: phrase,
      periodHint: periodHint,
      relativeKind: relativeKind,
      startOfDay: startOfDay(date)
    };
  }

  function periodShift(hour, period) {
    if (!period) return hour;
    if (period === '下午' || period === '傍晚') return hour < 12 ? hour + 12 : hour;
    if (period === '晚上' || period === '夜里' || period === '今晚' || period === '明晚') {
      if (hour === 12) return 0;
      return hour < 12 ? hour + 12 : hour;
    }
    if (period === '中午') return hour < 11 ? hour + 12 : hour;
    if (period === '凌晨') return hour === 12 ? 0 : hour;
    return hour;
  }

  function findPeriodBefore(text, index) {
    var before = text.slice(Math.max(0, index - 6), index);
    var m = before.match(/(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)\s*$/);
    return m ? m[1] : null;
  }

  function parseTime(text, periodHint) {
    var matches = [];
    var reColon = /(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/g;
    var m;
    while ((m = reColon.exec(text))) {
      var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
      var p = findPeriodBefore(text, m.index) || periodHint || null;
      h = periodShift(h, p);
      matches.push({ hour: h, minute: min, rawHour: parseInt(m[1], 10), phrase: m[0], index: m.index, end: m.index + m[0].length, period: p });
    }

    var rePoint = /(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|时)\s*(半|一刻|三刻|(?:(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*分?))?/g;
    while ((m = rePoint.exec(text))) {
      var raw = m[2];
      var rawHour = cnToNumber(raw);
      var hour = rawHour;
      if (isNaN(hour) || hour > 23) continue;
      var minute = 0;
      if (m[3]) {
        if (m[3] === '半') minute = 30;
        else if (m[3] === '一刻') minute = 15;
        else if (m[3] === '三刻') minute = 45;
        else if (m[4] != null) {
          var mm = cnToNumber(String(m[4]).replace(/\s*分$/, '').trim());
          if (!isNaN(mm) && mm >= 0 && mm < 60) minute = mm;
        }
      }
      var pp = m[1] || periodHint || null;
      hour = periodShift(hour, pp);
      matches.push({ hour: hour, minute: minute, rawHour: rawHour, phrase: m[0], index: m.index, end: m.index + m[0].length, period: pp });
    }

    if (!matches.length) return null;
    matches.sort(function (a, b) { return a.index - b.index; });
    var unique = [];
    matches.forEach(function (x) {
      if (!unique.some(function (y) { return Math.abs(y.index - x.index) < 2; })) unique.push(x);
    });

    var start = unique[0];
    var end = null;
    if (unique.length > 1) {
      var between = text.slice(start.end, unique[1].index).trim();
      if (/^(?:-|~|—|–|到|至|起至|至左右)$/.test(between)) end = unique[1];
    }
    if (end && !end.period && start.period) {
      end.period = start.period;
      end.hour = periodShift(end.rawHour, end.period);
    }
    if (end && !start.period && end.period) {
      start.period = end.period;
      start.hour = periodShift(start.rawHour, start.period);
    }
    if (!end) {
      var range = text.match(/(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|时|[:：])\s*(?:到|至|-|~|—)\s*(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})/);
      if (range) {
        var rh = cnToNumber(range[3]);
        if (!isNaN(rh)) {
          var rp = range[2] || start.period || null;
          rh = periodShift(rh, rp);
          end = { hour: rh, minute: 0, phrase: range[0] };
        }
      }
    }

    return {
      start: start,
      end: end,
      explicit: true,
      phrase: start.phrase,
      rangePhrase: end ? text.slice(start.index, end.index == null ? start.end : start.end + 20) : start.phrase
    };
  }

  function cleanForTitle(text) {
    return normalizeText(text)
      .replace(/@\s*\S+/g, ' ')
      .replace(/^[【\[][^】\]]{0,16}[】\]]\s*/, '')
      .replace(/^(?:通知|公告|提醒|重要通知)\s*[:：]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripSchedulePhrases(s) {
    return s
      .replace(/(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ')
      .replace(/(?:大后天|大后日|后天|明晚|明日|明天|今晚|今日|今天|后晚)/g, ' ')
      .replace(/(?:(?:这|本|下下|下)\s*)?(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, ' ')
      .replace(/(?:这个?)?周末/g, ' ')
      .replace(/(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)\s*/g, ' ')
      .replace(/(?:\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|时)\s*(?:半|一刻|三刻|\d{1,2}\s*分?)?/g, ' ')
      .replace(/\d{1,2}\s*[:：]\s*\d{2}/g, ' ')
      .replace(/\d{1,2}\s*[日号]\s*/g, ' ');
  }

  function findEvent(text) {
    var best = null;
    EVENT_RULES.forEach(function (rule) {
      rule.re.lastIndex = 0;
      var m;
      while ((m = rule.re.exec(text))) {
        var candidate = {
          key: rule.key,
          strong: rule.strong,
          duration: rule.duration,
          deadline: !!rule.deadline,
          phrase: m[0],
          index: m.index,
          end: m.index + m[0].length
        };
        if (!best || candidate.index < best.index ||
          (candidate.index === best.index && candidate.phrase.length > best.phrase.length)) {
          best = candidate;
        }
        if (m[0].length === 0) rule.re.lastIndex++;
      }
    });
    return best;
  }

  var NOTICE_META_RE = /^(?:时间|活动时间|地点|活动地点|地址|场地|主讲人|报告人|主讲|嘉宾|主持人|主办|承办|协办|主办单位|承办单位|题目|主题|内容|摘要|联系|备注)\s*(?:[:：]|$)/;
  var NOTICE_META_LINE_RE = /(?:^|\n)\s*(?:时间|活动时间|地点|活动地点|地址|场地|主讲人|报告人|主讲|嘉宾|主持人|主办|承办|协办|主办单位|承办单位|题目|主题|内容|摘要|联系|备注)\s*(?:[:：]|$)/m;

  function hasNoticeMeta(text) {
    return NOTICE_META_LINE_RE.test(text || '');
  }

  function noticeTitle(text) {
    var lines = String(text || '').split('\n').map(function (line) {
      return line.replace(/^[\s【\[]+|[】\]]+\s*$/g, '').trim();
    }).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (NOTICE_META_RE.test(line)) continue;
      if (/^(?:通知|公告|讲座|学术报告|报告会|论坛|活动通知)\s*[:：]?$/.test(line)) continue;
      line = line.replace(/^(?:题目|主题|讲座题目|报告题目|活动主题)\s*[:：]\s*/, '');
      line = line.replace(/^(?:学术报告|讲座|报告会|论坛)\s*[:：]\s*/, '');
      line = line.replace(/[，。；;]+$/, '').trim();
      if (line.length >= 4) return line.slice(0, 40);
    }
    var before = String(text || '').split(/\n(?=(?:时间|地点|地址|主讲人|主办|承办|题目|主题)\s*[:：])/)[0];
    before = before.replace(/_{2,}/g, ' ').replace(/\s+/g, ' ').trim();
    return before.length >= 4 ? before.slice(0, 40) : '日程';
  }

  function noticeNote(text) {
    var parts = [];
    var speaker = String(text || '').match(/(?:主讲人|报告人|主讲|嘉宾)\s*[:：]?\s*\n?\s*([^\n]{2,30})/);
    if (speaker) {
      var name = speaker[1].replace(/[:：\s]+$/, '').trim();
      if (name && !NOTICE_META_RE.test(name)) parts.push('主讲人：' + name);
    }
    var org = String(text || '').match(/(?:主办|承办)\s*[:：]\s*([^\n]{2,80})/);
    if (org) {
      var organizer = org[1].split(/承办\s*[:：]?/)[0].trim();
      if (organizer) parts.push('主办：' + organizer);
      var co = String(text || '').match(/承办\s*[:：]\s*([^\n]{2,80})/);
      if (co) parts.push('承办：' + co[1].trim());
    }
    return parts.join('\n').slice(0, 240);
  }

  function cutPrefix(prefix) {
    var cut = prefix.search(/[，。；！？、,.;!?：:\n]/);
    if (cut >= 0) prefix = prefix.slice(cut + 1);
    prefix = stripSchedulePhrases(prefix);
    prefix = prefix.replace(/^.*(?:请|通知|记得|大家|同学|老师|我们|你们|要|去|来|在|到|于|和|与|跟|给|准时|一起|统一|安排|组织|临时)/, '');
    prefix = prefix.replace(/^.*(?:参加|出席|举办|举行|听|观看|旁听)/, '');
    prefix = prefix.replace(/[，。；！？、,.;!?：:\s\d]/g, '');
    prefix = prefix.replace(/^[日号月年]+/, '');
    // 地点后缀不是标题的一部分
    if (/(?:会议室|教室|办公室|报告厅|体育馆|图书馆|食堂|操场|礼堂|实验室|医院|诊所|卫生室|楼|室|馆|场|校区|门口)$/.test(prefix)) {
      return '';
    }
    // “会议”出现在“开会”前时，多半是地点或说明，不再拼接
    if (prefix.indexOf('会议') >= 0) return '';
    return prefix;
  }

  function buildTitle(text, event) {
    var cleaned = cleanForTitle(text);
    if (!event) return cleaned.slice(0, 18);

    if (event.key === '交作业') {
      var m = cleaned.match(/(?:交|提交|上交|完成|写)[\u4e00-\u9fa5A-Za-z0-9]{0,10}?(?:作业|报告|材料|论文|表格|文件)/);
      if (m) return m[0].slice(0, 20);
    }
    if (event.key === '报名') {
      var r = cleaned.match(/报名(?:参加)?[\u4e00-\u9fa5A-Za-z0-9]{0,12}/);
      if (r) return r[0].slice(0, 20);
    }

    var idx = cleaned.indexOf(event.phrase);
    if (idx > 0) {
      var prefix = cleaned.slice(Math.max(0, idx - 14), idx);
      prefix = cutPrefix(prefix);
      if (prefix.length >= 2 && prefix.length <= 8 && !STOP_WORDS.test(prefix)) {
        var combined = (prefix + event.phrase).replace(/[，。；！？、,.;!?：:\s]/g, '');
        if (combined.length >= 2 && combined.length <= 20) return combined;
      }
    }
    return event.phrase.replace(/[，。；！？、,.;!?：:\s]/g, '').slice(0, 20) || '日程';
  }

  function findLocation(text) {
    var patterns = [
      /(?:地点|地址)\s*[:：]\s*([^\n，。；;]{2,24})/,
      /(?:在|于|到)\s*(?:明天|今天|后天|大后天|上午|下午|晚上|早上|中午|[\d:：月日号\s]{0,12})*(?:到|去)?\s*([\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:会议室|教室|办公室|报告厅|体育馆|图书馆|食堂|操场|礼堂|实验室|医院|诊所|卫生室|楼|室|馆|场|校区|门口))/,
      /([\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:会议室|教室|办公室|报告厅|体育馆|图书馆|食堂|操场|礼堂|实验室|医院|诊所|卫生室))/,
      /(腾讯会议|线上|钉钉|飞书|Zoom)/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) {
        var loc = m[1].replace(/^[在到于\s]+/, '').replace(/^.*(?:在|于|到)/, '')
          .replace(/^.*(?:今天|明天|后天|大后天|上午|下午|中午|晚上|早上|凌晨|\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*点|[一二三四五六七八九十]{1,3}\s*点)/, '')
          .replace(/[，。；;]+$/, '').trim();
        return loc.slice(0, 24);
      }
    }
    return '';
  }

  function isQuestion(text) {
    return /[?？]\s*$/.test(text.trim()) || /(?:吗|么|呢|是否|要不要|有没有)\s*[?？]?/.test(text);
  }

  function uncertainty(text) {
    return /(?:可能|也许|大概|或许|待定|暂定|不确定|再说|改天|有空)/.test(text);
  }

  function extractSchedule(input, options) {
    options = options || {};
    var now = options.now instanceof Date ? options.now : new Date();
    var text = normalizeText(input);
    if (!text) return null;
    if (text.length > 4000) text = text.slice(0, 4000);

    var dateInfo = parseDate(text, now);
    var event = findEvent(text);
    var timeInfo = parseTime(text, dateInfo ? dateInfo.periodHint : null);
    var notice = !event && !!(dateInfo && timeInfo && hasNoticeMeta(text));
    if (!event && !notice) return null;
    if (!event) {
      event = { key: 'notice', strong: true, duration: 60, deadline: false, phrase: '', index: 0 };
    }
    if (!dateInfo && !timeInfo) return null;

    var baseDate = dateInfo ? new Date(dateInfo.startOfDay) : startOfDay(now);
    var allDay = !timeInfo;
    var startHour = timeInfo ? timeInfo.start.hour : 9;
    var startMinute = timeInfo ? timeInfo.start.minute : 0;

    if (!dateInfo && timeInfo) {
      var inferred = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, startMinute);
      if (inferred.getTime() < now.getTime() - 30 * 60000) {
        inferred = addDays(inferred, 1);
      }
      baseDate = startOfDay(inferred);
    }

    var start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), startHour, startMinute);
    var end;
    if (timeInfo && timeInfo.end) {
      end = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), timeInfo.end.hour, timeInfo.end.minute);
      if (end <= start) end = shiftDays(end, 1);
    } else {
      var duration = event.duration || 60;
      if (event.deadline && !timeInfo) duration = 30;
      end = new Date(start.getTime() + duration * 60000);
    }

    var title = notice ? noticeTitle(text) : buildTitle(text, event);
    var location = findLocation(text);
    var note = notice ? noticeNote(text) : '';

    var confidence = 0.42;
    if (dateInfo) confidence += 0.22;
    if (timeInfo) confidence += 0.18;
    confidence += event.strong ? 0.13 : 0.06;
    if (location) confidence += 0.02;
    if (notice) confidence += 0.03;
    if (isQuestion(text)) confidence -= 0.16;
    if (uncertainty(text)) confidence -= 0.11;
    if (!dateInfo && timeInfo) confidence -= 0.09;
    if (!timeInfo) confidence -= 0.04;
    confidence = Math.max(0.32, Math.min(0.97, confidence));

    var reasons = [];
    if (dateInfo) reasons.push('明确日期');
    if (timeInfo) reasons.push('明确时间');
    if (location) reasons.push('包含地点');
    if (notice) reasons.push('通知格式');
    if (!dateInfo) reasons.push('日期为推测');
    if (!timeInfo) reasons.push('未说明时间');
    if (isQuestion(text)) reasons.push('疑似询问');
    if (uncertainty(text)) reasons.push('语气不确定');

    return {
      title: title,
      start: localISO(start),
      end: localISO(end),
      date: dateKey(start),
      time: allDay ? null : timeKey(start),
      allDay: allDay,
      location: location,
      note: note,
      confidence: Math.round(confidence * 100) / 100,
      reasons: reasons,
      keyword: event.key,
      needsDate: !dateInfo,
      needsTime: !timeInfo,
      isQuestion: isQuestion(text),
      sourceText: text
    };
  }

  function looksScheduleLike(input) {
    var text = normalizeText(input);
    if (!text || text.length < 5 || text.length > 4000) return false;
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(text)) return false;
    if (/^(?:\S{1,20}[:：]\s*)?(?:\*{3,}|•{3,}|●{3,})$/.test(text)) return false;
    var hasEvent = !!findEvent(text);
    var hasDate = /(?:\d{1,2}\s*月\s*\d{1,2}|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./]\d{1,2}|今天|明天|后天|大后天|今晚|明晚|(?:这|本|下)?周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|\d{1,2}\s*[日号])/.test(text);
    var hasTime = /(?:\d{1,2}\s*[:：]\s*\d{2}|(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[点时])/.test(text);
    if (hasEvent && (hasDate || hasTime)) return true;
    // 通知 / 海报格式：没有“开会 / 讲座”等词，但时间、地点、主讲人等字段齐全。
    if (hasDate && hasTime && hasNoticeMeta(text)) return true;
    return false;
  }

  function looksAICandidate(input) {
    var text = normalizeText(input);
    if (!text || text.length < 5 || text.length > 4000) return false;
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(text)) return false;
    if (looksScheduleLike(text)) return true;
    var hasDate = /(?:\d{1,2}\s*月\s*\d{1,2}|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./]\d{1,2}|今天|明天|后天|大后天|今晚|明晚|(?:这|本|下)?周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|\d{1,2}\s*[日号])/.test(text);
    var hasTime = /(?:\d{1,2}\s*[:：]\s*\d{2}|(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[点时])/.test(text);
    if (hasDate && hasTime) return true;
    // AI-first 通道：没有明确日期也放行，交给模型判断；仍然排除密码、链接等无信号内容。
    return /(?:通知|公告|安排|活动|讲座|报告|会议|开会|报名|截止|地点|时间|主讲|主办|承办|考试|作业|面试|体检|聚餐|集合|日程|签到|课程|培训|论坛|分享)/.test(text);
  }

  function isTimeLikePrefix(text) {
    var s = String(text || '').trim();
    return /^\d{4}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}/.test(s) ||
      /^\d{1,2}\s*[月./-]\s*\d{1,2}/.test(s) ||
      /^\d{1,2}\s*[:：]\s*\d{2}/.test(s) ||
      /^\d{4}\s*年/.test(s);
  }

  function parseMessages(raw, options) {
    options = options || {};
    var text = normalizeText(raw);
    if (!text) return { platform: 'unknown', channelName: '', messages: [] };

    var platform = options.platform || 'unknown';
    if (platform === 'unknown') {
      if (/\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}/.test(text)) platform = 'qq';
      else if (/(?:微信|WeChat)/i.test(text)) platform = 'wechat';
    }

    var lines = text.split('\n');
    var channelName = '';
    var bodyStart = 0;
    var metaSender = /^(?:时间|活动时间|地点|活动地点|地址|场地|主讲人|报告人|主讲|嘉宾|主持人|主办|承办|协办|题目|主题|内容|摘要|联系|备注|通知|公告|主办单位|承办单位)$/;

    var first = (lines[0] || '').trim();
    var second = (lines[1] || '').trim();
    var secondSender = second.match(/^([^:：\n]{1,24})[:：]/);
    var secondIsChat = !!(secondSender && !metaSender.test(secondSender[1].trim()));
    if (first && !/[:：]/.test(first) && first.length <= 30 &&
      !/\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(first) &&
      !metaSender.test(first) &&
      !isTimeLikePrefix(first) &&
      (!hasNoticeMeta(text) || secondIsChat) &&
      !findEvent(first) &&
      lines.length > 1) {
      channelName = first.replace(/[【】\[\]]/g, '').trim();
      bodyStart = 1;
    }

    var messages = [];
    var current = null;
    var qqHeader = /^(.{1,24}?)\s+(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
    var wxSender = /^([^:：\n]{1,24})[:：]\s*(.*)$/;

    for (var i = bodyStart; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (!trimmed) {
        if (current) current.lines.push('');
        continue;
      }
      var qm = trimmed.match(qqHeader);
      if (qm) {
        if (current) messages.push(current);
        current = { sender: qm[1].trim(), at: qm[2].replace(/\//g, '-'), lines: [] };
        continue;
      }
      var wm = line.match(wxSender);
      if (wm && !metaSender.test(wm[1].trim()) && !isTimeLikePrefix(wm[1].trim()) && !/^https?$/i.test(wm[1].trim())) {
        if (current) messages.push(current);
        current = { sender: wm[1].trim(), at: '', lines: [wm[2]] };
        continue;
      }
      if (current) current.lines.push(line);
      else current = { sender: '', at: '', lines: [line] };
    }
    if (current) messages.push(current);

    messages = messages.map(function (msg) {
      var body = msg.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      return {
        sender: msg.sender || '',
        at: msg.at || '',
        text: body,
        channelName: channelName || (options.channelName || '')
      };
    }).filter(function (m) { return m.text; });

    if (!messages.length) {
      messages.push({ sender: '', at: '', text: text, channelName: channelName });
    }

    return { platform: platform, channelName: channelName, messages: messages };
  }

  function extractAll(input, options) {
    options = options || {};
    var text = normalizeText(input);
    if (!text) return [];
    var pieces = text.split(/\n+|(?<=[。！？!?；;])/).map(function (s) { return s.trim(); }).filter(Boolean);
    var results = [];
    pieces.forEach(function (piece) {
      if (!looksScheduleLike(piece)) return;
      var ev = extractSchedule(piece, options);
      if (ev) results.push(ev);
    });
    if (!results.length) {
      var whole = extractSchedule(text, options);
      if (whole) results.push(whole);
    }
    var seen = {};
    return results.filter(function (ev) {
      var key = ev.start + '|' + ev.title;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  return {
    normalizeText: normalizeText,
    parseDate: parseDate,
    parseTime: parseTime,
    extractSchedule: extractSchedule,
    extractAll: extractAll,
    parseMessages: parseMessages,
    looksScheduleLike: looksScheduleLike,
    looksAICandidate: looksAICandidate,
    localISO: localISO,
    findEvent: findEvent,
    _internal: { cnToNumber: cnToNumber, periodShift: periodShift }
  };
});
