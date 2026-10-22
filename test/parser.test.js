const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/parser');

const NOW = new Date(2026, 9, 22, 9, 0, 0); // 2026-10-22 周四 09:00

function ev(text, now = NOW) {
  return P.extractSchedule(text, { now });
}

test('后天10点开会', () => {
  const e = ev('@所有人 学校通知：后天上午10点在三楼会议室开会，请准时参加');
  assert.ok(e);
  assert.equal(e.title, '开会');
  assert.equal(e.start, '2026-10-24T10:00');
  assert.equal(e.end, '2026-10-24T11:00');
  assert.equal(e.location, '三楼会议室');
  assert.ok(e.confidence >= 0.9);
});

test('下周三下午3点半交数学作业', () => {
  const e = ev('下周三下午3点半交数学作业');
  assert.ok(e);
  assert.equal(e.start, '2026-10-28T15:30');
  assert.equal(e.title, '交数学作业');
  assert.equal(e.allDay, false);
});

test('10月25日 19:00 家长会', () => {
  const e = ev('10月25日 19:00 家长会');
  assert.ok(e);
  assert.equal(e.start, '2026-10-25T19:00');
  assert.equal(e.title, '家长会');
});

test('明天早上8:20到校', () => {
  const e = ev('明天早上8:20到校，别迟到');
  assert.ok(e);
  assert.equal(e.start, '2026-10-23T08:20');
  assert.equal(e.title, '到校');
});

test('今晚7点开会', () => {
  const e = ev('今晚7点开会');
  assert.ok(e);
  assert.equal(e.start, '2026-10-22T19:00');
});

test('周五前交作业（无时间，全天）', () => {
  const e = ev('周五前交作业');
  assert.ok(e);
  assert.equal(e.start, '2026-10-23T09:00');
  assert.equal(e.allDay, true);
  assert.equal(e.title, '交作业');
});

test('11月5日考试', () => {
  const e = ev('11月5日上午9点考试');
  assert.ok(e);
  assert.equal(e.start, '2026-11-05T09:00');
});

test('时间范围 下午3点到5点', () => {
  const e = ev('明天下午3点到5点开会');
  assert.ok(e);
  assert.equal(e.start, '2026-10-23T15:00');
  assert.equal(e.end, '2026-10-23T17:00');
});

test('下个月5号体检', () => {
  const e = ev('下个月5号上午9点体检');
  assert.ok(e);
  assert.equal(e.start, '2026-11-05T09:00');
});

test('疑问句降低置信度', () => {
  const a = ev('后天10点开会');
  const b = ev('后天10点开会吗？');
  assert.ok(a && b);
  assert.ok(b.confidence < a.confidence);
});

test('推测日期：10点开会', () => {
  const e = ev('10点开会');
  assert.ok(e);
  assert.equal(e.date, '2026-10-22');
  assert.equal(e.needsDate, true);
});

test('聊天记录分块解析：微信群名 + 发送人', () => {
  const r = P.parseMessages('三年二班家长群\n张老师: 后天10点开会\n李妈妈: 收到');
  assert.equal(r.channelName, '三年二班家长群');
  assert.equal(r.messages.length, 2);
  assert.equal(r.messages[0].sender, '张老师');
  assert.equal(r.messages[0].text, '后天10点开会');
});

test('QQ 时间戳格式解析', () => {
  const r = P.parseMessages('三年二班\n张老师 2026/10/22 10:00:00\n后天10点开会');
  assert.equal(r.platform, 'qq');
  assert.equal(r.channelName, '三年二班');
  assert.equal(r.messages[0].sender, '张老师');
  assert.equal(r.messages[0].text, '后天10点开会');
});

test('剪贴板过滤：只有带日程信号才通过', () => {
  assert.equal(P.looksScheduleLike('后天10点开会'), true);
  assert.equal(P.looksScheduleLike('我的密码是 abc123!'), false);
  assert.equal(P.looksScheduleLike('https://example.com/a/b'), false);
  assert.equal(P.looksAICandidate('2026年10月24日 14:30 图书馆报告厅 王教授'), true);
  assert.equal(P.looksAICandidate('我的密码是 abc123!'), false);
});

test('复杂地点与标题', () => {
  const e = ev('请于明天14:30到图书馆报告厅参加新生讲座');
  assert.ok(e);
  assert.equal(e.location, '图书馆报告厅');
  assert.equal(e.start, '2026-10-23T14:30');
});

test('后天10点不会被误判为晚上10点', () => {
  const e = ev('后天10点开会');
  assert.ok(e);
  assert.equal(e.start, '2026-10-24T10:00');
});

test('三天后支持中文数字', () => {
  const e = ev('三天后开会');
  assert.ok(e);
  assert.equal(e.start, '2026-10-25T09:00');
  assert.equal(e.allDay, true);
});

test('带日期和医院地点的标题不粘连', () => {
  const e = ev('下周一上午9点校医院体检，空腹。');
  assert.ok(e);
  assert.equal(e.title, '体检');
  assert.equal(e.location, '校医院');
  assert.equal(e.start, '2026-10-26T09:00');
});

test('周会与线上地点', () => {
  const e = ev('明天项目周会改到十点，线上。');
  assert.ok(e);
  assert.equal(e.title, '项目周会');
  assert.equal(e.time, '10:00');
  assert.equal(e.location, '线上');
});

test('结构化讲座通知（无“讲座/开会”关键词）', () => {
  const text = [
    '深刻理解习近平党建思想的精髓要义',
    '主讲人',
    '姚润皋',
    '南京大学哲学学院教授，博士生导师',
    '地点:苏教A108教室',
    '时间:2026年10月23日上午11:00-12:00',
    '主办:南京大学关心下一代工作委员会'
  ].join('__');
  assert.equal(P.looksScheduleLike(text), true);
  const e = ev(text);
  assert.ok(e);
  assert.equal(e.title, '深刻理解习近平党建思想的精髓要义');
  assert.equal(e.start, '2026-10-23T11:00');
  assert.equal(e.end, '2026-10-23T12:00');
  assert.equal(e.location, '苏教A108教室');
  assert.match(e.note, /姚润皋/);
  assert.ok(e.confidence >= 0.9);
});

test('点号日期与通知字段', () => {
  const e = ev('学术报告__地点:图书馆报告厅__时间:2026.10.23 14:30-16:00');
  assert.ok(e);
  assert.equal(e.start, '2026-10-23T14:30');
  assert.equal(e.end, '2026-10-23T16:00');
  assert.equal(e.location, '图书馆报告厅');
});

test('群名 + 通知正文时仍保留群名', () => {
  const r = P.parseMessages('三年二班家长群\n张老师: 明天家长会\n地点:三楼会议室\n时间:2026-10-24 10:00');
  assert.equal(r.channelName, '三年二班家长群');
  assert.equal(r.messages[0].sender, '张老师');
  assert.match(r.messages[0].text, /地点:三楼会议室/);
});

test('开头是日期时间时不误判为发送人', () => {
  const r = P.parseMessages('2026年10月24日 14:30 图书馆报告厅 王教授');
  assert.equal(r.messages[0].sender, '');
  assert.match(r.messages[0].text, /^2026年10月24日 14:30/);
});
