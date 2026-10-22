/* 日序 · 渲染层应用逻辑 */
(function () {
  'use strict';

  const P = window.RixuParser;
  const ROOT = document.getElementById('app');
  const TOAST_ROOT = document.getElementById('toast-root');
  const MODAL_ROOT = document.getElementById('modal-root');
  const IS_DESKTOP = !!(window.rixu && window.rixu.isDesktop);
  const IS_SCREENSHOT = /(?:^|[?&])screenshot=1(?:&|$)/.test(location.search);
  const DEMO_MODE = /(?:^|[?&])demo=1(?:&|$)/.test(location.search);
  const STORAGE_KEY = 'rixu.data.v1';

  const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEKDAY_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

  const FALLBACK_BRIDGE = {
    isDesktop: false,
    async loadData() {
      let data = null;
      try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { data = null; }
      return { data: data, dataPath: '浏览器 localStorage' };
    },
    async saveData(data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    },
    async setCaptureEnabled() { return false; },
    async readClipboard() { return ''; },
    async takeClipboard() { return { ok: false, reason: 'browser' }; },
    async notify() { return false; },
    async setCloseToTray() { return true; },
    async setLoginItem() { return false; },
    async getLoginItem() { return false; },
    async openDataFolder() { return '仅桌面版可用'; },
    async exportData() { return { ok: false }; },
    async importData() { return { ok: false }; },
    async aiExtract() { return { ok: false, error: '浏览器预览不支持 AI 调用' }; },
    async aiAvailable() { return false; },
    async napcatConfigure() { return { enabled: false, status: 'disabled', error: '浏览器预览不支持 NapCat' }; },
    async napcatStatus() { return { enabled: false, status: 'disabled' }; },
    async napcatReconnect() { return { enabled: false, status: 'disabled' }; },
    async napcatDisconnect() { return { enabled: false, status: 'disabled' }; },
    onCapture() { return function () {}; },
    onCaptureState() { return function () {}; },
    onManualCapture() { return function () {}; },
    onNapcatStatus() { return function () {}; },
    onNapcatSources() { return function () {}; },
    onNapcatMessage() { return function () {}; }
  };

  const bridge = IS_DESKTOP ? window.rixu : FALLBACK_BRIDGE;

  let data = null;
  let dataPath = '';
  let view = 'calendar';
  let selectedDate = todayKey();
  let monthCursor = startOfMonth(new Date());
  let modalState = null;
  let toastTimer = null;
  let saveTimer = null;
  let captureOn = false;
  let napcatStatus = { enabled: false, status: 'disabled', error: '', url: '', groups: 0, friends: 0 };
  let sourceFilter = 'all';
  let sourceQuery = '';
  let lastView = '';
  let scrollMemory = {};
  let lastAutoEventId = null;
  let lastDeleted = null;
  let lastAIErrorAt = 0;
  let aiKeyAvailable = false;
  let aiTesting = false;
  let appVersion = '0.1.2';
  let reminderTimer = null;
  let napcatSyncedThisSession = false;
  let lastNapcatStatus = '';
  let demoPreview = false;

  const ICONS = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    inbox: '<path d="M4 4h16l2 7v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7l2-7z"/><path d="M2 11h6l2 3h4l2-3h6"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    clipboard: '<rect x="7" y="3" width="10" height="4" rx="1.5"/><path d="M8 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3"/><path d="M8 12h8M8 16h5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 21h16"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.7-1L20 12M4 12l2.2 5a7 7 0 0 0 11.7-1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    sparkles: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1L6.5 8.5l4.1-1.4L12 3z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 9v5M12 17v.01"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.4l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.4l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/>',
    robot: '<rect x="4" y="8" width="16" height="12" rx="4"/><path d="M12 4v4M8 14h.01M16 14h.01M9 18h6"/>'
  };

  function icon(name, size, strokeWidth) {
    const path = ICONS[name] || ICONS.calendar;
    const s = size || 17;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      (strokeWidth || 1.6) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayKey() { return dateKey(new Date()); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function parseKey(key) {
    const parts = String(key || todayKey()).split('-').map(Number);
    return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  }
  function addDays(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }
  function addMinutes(d, n) { return new Date(d.getTime() + n * 60000); }
  function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
  function localISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function isoDate(iso) { return String(iso || '').slice(0, 10); }
  function isoTime(iso) { return String(iso || '').slice(11, 16); }
  function toDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return new Date(iso);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  }
  function weekdayFull(d) { return WEEKDAY_FULL[d.getDay()]; }
  function weekdayShort(d) { return WEEKDAY_SHORT[d.getDay()]; }
  function fullDateCN(d) { return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'; }
  function shortDateCN(key) {
    const d = parseKey(key);
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }
  function relativeDay(key) {
    const today = parseKey(todayKey()).getTime();
    const target = parseKey(key).getTime();
    const diff = Math.round((target - today) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    return shortDateCN(key);
  }
  function relativeTime(iso) {
    if (!iso) return '尚未采集';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const diff = Date.now() - then;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 172800000) return '昨天';
    const d = new Date(then);
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function defaultSettings() {
    return {
      captureEnabled: false,
      autoAdd: true,
      autoThreshold: 0.82,
      notify: true,
      reminderMinutes: 10,
      closeToTray: true,
      openAtLogin: false,
      llm: {
        enabled: true,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: ''
      },
      napcat: {
        enabled: false,
        url: 'ws://127.0.0.1:3001',
        token: ''
      }
    };
  }

  function createEmptyData() {
    return {
      version: 1,
      events: [],
      sources: [],
      inbox: [],
      settings: defaultSettings(),
      meta: {
        onboarded: false,
        demo: false,
        createdAt: new Date().toISOString(),
        hashes: [],
        notified: {}
      }
    };
  }

  function normalizeData(raw) {
    const base = createEmptyData();
    if (!raw || typeof raw !== 'object') return base;
    const settings = defaultSettings();
    if (raw.settings && typeof raw.settings === 'object') {
      Object.keys(settings).forEach((key) => {
        if (key === 'llm' || key === 'napcat') return;
        if (raw.settings[key] !== undefined) settings[key] = raw.settings[key];
      });
      if (raw.settings.llm) Object.assign(settings.llm, raw.settings.llm);
      if (raw.settings.napcat) Object.assign(settings.napcat, raw.settings.napcat);
    }
    const meta = Object.assign({}, base.meta, raw.meta || {});
    if (!Array.isArray(meta.hashes)) meta.hashes = [];
    if (!meta.notified || typeof meta.notified !== 'object') meta.notified = {};

    const sources = (Array.isArray(raw.sources) ? raw.sources : []).map((s) => {
      if (!s || typeof s !== 'object') return null;
      const importance = ['important', 'normal', 'ignored', 'unclassified'].indexOf(s.importance) >= 0 ? s.importance : 'normal';
      return {
        id: s.id || uid('src'),
        externalId: s.externalId || '',
        platform: s.platform || 'unknown',
        name: String(s.name || '未命名会话'),
        kind: s.kind || 'unknown',
        importance: importance,
        lastText: String(s.lastText || ''),
        lastAt: s.lastAt || '',
        count: Number(s.count) || 0,
        memberCount: Number(s.memberCount) || 0,
        createdAt: s.createdAt || new Date().toISOString()
      };
    }).filter(Boolean);

    const events = (Array.isArray(raw.events) ? raw.events : []).map((e) => {
      if (!e || typeof e !== 'object' || !e.start) return null;
      return {
        id: e.id || uid('evt'),
        title: String(e.title || '日程'),
        start: String(e.start),
        end: String(e.end || e.start),
        allDay: !!e.allDay,
        location: String(e.location || ''),
        sourceId: e.sourceId || '',
        sourceName: String(e.sourceName || ''),
        platform: e.platform || 'unknown',
        rawText: String(e.rawText || ''),
        note: String(e.note || ''),
        confidence: Number(e.confidence) || 0,
        viaAI: !!e.viaAI,
        auto: !!e.auto,
        status: e.status || 'confirmed',
        reminderSentAt: e.reminderSentAt || '',
        createdAt: e.createdAt || new Date().toISOString()
      };
    }).filter(Boolean);

    const inbox = (Array.isArray(raw.inbox) ? raw.inbox : []).map((i) => {
      if (!i || typeof i !== 'object') return null;
      const schedule = i.schedule || (i.start ? i : null);
      if (!schedule || !schedule.start) return null;
      return {
        id: i.id || uid('inbox'),
        sourceId: i.sourceId || '',
        sourceName: String(i.sourceName || ''),
        platform: i.platform || 'unknown',
        sender: String(i.sender || ''),
        text: String(i.text || ''),
        receivedAt: i.receivedAt || new Date().toISOString(),
        schedule: schedule,
        viaAI: !!i.viaAI,
        confidence: Number(i.confidence || schedule.confidence) || 0,
        status: i.status || 'pending'
      };
    }).filter(Boolean);

    return {
      version: 1,
      events,
      sources,
      inbox,
      settings,
      meta
    };
  }

  function demoAt(offsetDays, hour, minute) {
    const d = addDays(new Date(), offsetDays);
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  function seedDemo() {
    const d = createEmptyData();
    d.meta.demo = true;
    d.meta.onboarded = true;
    d.settings.captureEnabled = false;
    d.sources = [
      {
        id: 'src_demo_school', externalId: 'demo-wechat-school', platform: 'wechat', name: '三年二班家长群', kind: 'group',
        importance: 'important', lastText: '张老师：后天上午10点在三楼会议室开家长会，请准时参加', lastAt: demoAt(0, -1, 42).toISOString(),
        count: 6, memberCount: 48, createdAt: demoAt(-30, 10, 0).toISOString()
      },
      {
        id: 'src_demo_qq', externalId: 'demo-qq-class', platform: 'qq', name: '高一（3）班通知群', kind: 'group',
        importance: 'important', lastText: '班主任：下周三下午3点半前交数学作业', lastAt: demoAt(0, -2, 15).toISOString(),
        count: 4, memberCount: 52, createdAt: demoAt(-25, 9, 0).toISOString()
      },
      {
        id: 'src_demo_lee', externalId: 'demo-wechat-lee', platform: 'wechat', name: '李老师', kind: 'friend',
        importance: 'normal', lastText: '明天项目周会改到十点，线上。', lastAt: demoAt(-1, -3, 10).toISOString(),
        count: 2, createdAt: demoAt(-20, 11, 0).toISOString()
      },
      {
        id: 'src_demo_design', externalId: 'demo-wechat-design', platform: 'wechat', name: '设计小组', kind: 'group',
        importance: 'ignored', lastText: '', lastAt: demoAt(-1, -6, 20).toISOString(),
        count: 18, memberCount: 9, createdAt: demoAt(-40, 14, 0).toISOString()
      },
      {
        id: 'src_demo_unclassified', externalId: 'demo-qq-club', platform: 'qq', name: '摄影社 2026', kind: 'group',
        importance: 'unclassified', lastText: '', lastAt: demoAt(0, -4, 5).toISOString(),
        count: 3, memberCount: 87, createdAt: demoAt(-16, 16, 0).toISOString()
      }
    ];

    const e1 = demoAt(0, 19, 0);
    const e2 = demoAt(1, 10, 0);
    const e3 = demoAt(2, 10, 0);
    const e4 = demoAt(3, 18, 0);
    const e5 = demoAt(5, 9, 0);
    const e6 = demoAt(-2, 14, 0);

    d.events = [
      {
        id: 'evt_demo_dinner', title: '和室友吃晚饭', start: localISO(e1), end: localISO(addMinutes(e1, 90)), allDay: false,
        location: '南门小馆', sourceId: '', sourceName: '手动添加', platform: 'manual', rawText: '', note: '',
        confidence: 1, auto: false, status: 'confirmed', createdAt: demoAt(-1, 12, 0).toISOString()
      },
      {
        id: 'evt_demo_project', title: '项目周会', start: localISO(e2), end: localISO(addMinutes(e2, 60)), allDay: false,
        location: '线上', sourceId: 'src_demo_lee', sourceName: '李老师', platform: 'wechat',
        rawText: '明天项目周会改到十点，线上。', note: '', confidence: 0.92, auto: false, status: 'confirmed',
        createdAt: demoAt(-1, 10, 0).toISOString()
      },
      {
        id: 'evt_demo_parent', title: '家长会', start: localISO(e3), end: localISO(addMinutes(e3, 90)), allDay: false,
        location: '三楼会议室', sourceId: 'src_demo_school', sourceName: '三年二班家长群', platform: 'wechat',
        rawText: '张老师：后天上午10点在三楼会议室开家长会，请准时参加。', note: '', confidence: 0.96, auto: true,
        status: 'confirmed', createdAt: demoAt(0, -1, 40).toISOString()
      },
      {
        id: 'evt_demo_homework', title: '交课程论文', start: localISO(e4), end: localISO(addMinutes(e4, 30)), allDay: false,
        location: '', sourceId: 'src_demo_qq', sourceName: '高一（3）班通知群', platform: 'qq',
        rawText: '班主任：下周一前交课程论文，电子版发我。', note: '', confidence: 0.88, auto: true,
        status: 'confirmed', createdAt: demoAt(0, -2, 10).toISOString()
      },
      {
        id: 'evt_demo_checkup', title: '体检', start: localISO(e5), end: localISO(addMinutes(e5, 120)), allDay: false,
        location: '校医院', sourceId: 'src_demo_qq', sourceName: '高一（3）班通知群', platform: 'qq',
        rawText: '下周一上午9点校医院体检，空腹。', note: '', confidence: 0.9, auto: false,
        status: 'confirmed', createdAt: demoAt(-3, 9, 0).toISOString()
      },
      {
        id: 'evt_demo_past', title: '教研组会议', start: localISO(e6), end: localISO(addMinutes(e6, 60)), allDay: false,
        location: '二楼会议室', sourceId: 'src_demo_school', sourceName: '三年二班家长群', platform: 'wechat',
        rawText: '', note: '', confidence: 0.9, auto: false, status: 'confirmed', createdAt: demoAt(-4, 8, 0).toISOString()
      }
    ];

    const pendingDate = demoAt(4, 12, 0);
    const pendingDate2 = demoAt(8, 9, 0);
    d.inbox = [
      {
        id: 'inbox_demo_signup', sourceId: 'src_demo_school', sourceName: '三年二班家长群', platform: 'wechat', sender: '张老师',
        text: '下周一中午12点前报名数学竞赛，想参加的接龙。', receivedAt: demoAt(0, -1, 35).toISOString(),
        schedule: {
          title: '报名数学竞赛', start: localISO(pendingDate), end: localISO(addMinutes(pendingDate, 30)), allDay: false,
          date: dateKey(pendingDate), time: '12:00', location: '', confidence: 0.79,
          reasons: ['明确日期', '明确时间', '需确认'], needsDate: false, needsTime: false
        },
        viaAI: false, confidence: 0.79, status: 'pending'
      },
      {
        id: 'inbox_demo_material', sourceId: 'src_demo_qq', sourceName: '高一（3）班通知群', platform: 'qq', sender: '班主任',
        text: '下周五前交社会实践材料，电子版发我。', receivedAt: demoAt(0, -2, 5).toISOString(),
        schedule: {
          title: '交社会实践材料', start: localISO(pendingDate2), end: localISO(addMinutes(pendingDate2, 30)), allDay: true,
          date: dateKey(pendingDate2), time: null, location: '', confidence: 0.76,
          reasons: ['明确日期', '未说明时间'], needsDate: false, needsTime: true
        },
        viaAI: false, confidence: 0.76, status: 'pending'
      }
    ];
    d.meta.hashes = [];
    return d;
  }

  function sourceById(id) {
    if (!id) return null;
    return data.sources.find((s) => s.id === id) || null;
  }

  function findSource(externalId, name, platform) {
    let source = null;
    if (externalId) source = data.sources.find((s) => s.externalId === externalId);
    if (!source && name) {
      source = data.sources.find((s) => s.name === name && (!externalId || !s.externalId) && (s.platform === platform || !platform));
    }
    return source || null;
  }

  function ensureSource(opts) {
    let source = findSource(opts.externalId, opts.name, opts.platform);
    if (source) {
      if (opts.name && (!source.name || /^QQ群 \d+$/.test(source.name) || source.name === '剪贴板片段')) {
        source.name = opts.name;
      }
      if (opts.memberCount) source.memberCount = opts.memberCount;
      return source;
    }
    source = {
      id: uid('src'),
      externalId: opts.externalId || '',
      platform: opts.platform || 'unknown',
      name: opts.name || '未命名会话',
      kind: opts.kind || 'unknown',
      importance: opts.importance || 'normal',
      lastText: '',
      lastAt: '',
      count: 0,
      memberCount: opts.memberCount || 0,
      createdAt: new Date().toISOString()
    };
    data.sources.push(source);
    return source;
  }

  function inboxPending() {
    return data.inbox.filter((i) => i.status === 'pending');
  }

  function eventsOn(key) {
    return data.events
      .filter((e) => isoDate(e.start) === key)
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.localeCompare(b.start);
      });
  }

  function sourceImportance(source) {
    return source ? source.importance : 'normal';
  }

  function eventTone(event) {
    const source = sourceById(event.sourceId);
    if (source && source.importance === 'important') return 'important';
    if (source && source.importance === 'ignored') return 'muted';
    if (event.platform === 'qq') return 'other';
    if (source && source.importance === 'unclassified') return 'muted';
    return 'normal';
  }

  function sourceTone(source) {
    if (!source) return 'muted';
    if (source.importance === 'important') return 'important';
    if (source.platform === 'qq') return 'other';
    return 'normal';
  }

  function platformLabel(platform) {
    if (platform === 'wechat') return '微信';
    if (platform === 'qq') return 'QQ';
    if (platform === 'manual') return '手动';
    return '其他';
  }

  function kindLabel(kind) {
    if (kind === 'group') return '群聊';
    if (kind === 'friend') return '好友';
    return '会话';
  }

  function sourceInitial(source) {
    const name = source && source.name ? source.name : '日';
    if (/^QQ群/.test(name)) return '群';
    return name.slice(0, 1);
  }

  function formatScheduleWhen(schedule) {
    if (!schedule || !schedule.start) return '时间待补';
    const d = toDate(schedule.start);
    const datePart = shortDateCN(schedule.date || isoDate(schedule.start)) + ' ' + weekdayShort(d);
    if (schedule.allDay) return datePart + ' · 全天';
    const end = schedule.end ? toDate(schedule.end) : null;
    let time = isoTime(schedule.start);
    if (end && isoDate(schedule.end) === isoDate(schedule.start)) time += ' – ' + isoTime(schedule.end);
    else if (end) time += ' – 次日 ' + isoTime(schedule.end);
    return datePart + ' · ' + time;
  }

  function formatEventWhen(event) {
    const d = toDate(event.start);
    const datePart = fullDateCN(d) + ' ' + weekdayFull(d);
    if (event.allDay) return datePart + ' · 全天';
    return datePart + ' · ' + isoTime(event.start) + (event.end ? ' – ' + (isoDate(event.end) !== isoDate(event.start) ? '次日 ' : '') + isoTime(event.end) : '');
  }

  function confidenceLabel(confidence) {
    if (confidence >= 0.85) return '较确定';
    if (confidence >= 0.7) return '可能';
    return '待补充';
  }

  function confidenceClass(confidence) {
    if (confidence >= 0.85) return 'high';
    if (confidence >= 0.7) return 'mid';
    return '';
  }

  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveNow(); }, 260);
  }

  async function saveNow() {
    if (demoPreview) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    try {
      await bridge.saveData(data);
    } catch (err) {
      showToast({ type: 'error', title: '保存失败', body: '数据没有写入本地，请检查磁盘权限。' });
    }
  }

  function rememberHash(hash) {
    if (!data.meta.hashes) data.meta.hashes = [];
    if (!data.meta.hashes.includes(hash)) data.meta.hashes.push(hash);
    if (data.meta.hashes.length > 400) data.meta.hashes = data.meta.hashes.slice(-400);
  }

  function selectedDay() { return parseKey(selectedDate); }

  function openModal(state) {
    modalState = state;
    renderModal();
  }

  function closeModal() {
    modalState = null;
    renderModal();
  }

  function showToast(opts) {
    if (!TOAST_ROOT) return;
    if (toastTimer) clearTimeout(toastTimer);
    const actions = Array.isArray(opts.actions) ? opts.actions : [];
    TOAST_ROOT.innerHTML = '<div class="toast ' + (opts.type === 'error' ? 'error' : '') + '" role="status">' +
      '<div class="toast-icon">' + icon(opts.type === 'error' ? 'alert' : (opts.icon || 'check'), 14) + '</div>' +
      '<div class="toast-body"><strong>' + esc(opts.title || '') + '</strong>' +
      (opts.body ? '<span>' + esc(opts.body) + '</span>' : '') + '</div>' +
      (actions.length ? '<div class="toast-actions">' + actions.map((a) =>
        '<button class="' + (a.quiet ? 'quiet' : '') + '" data-action="' + esc(a.action) + '"' +
        (a.id ? ' data-id="' + esc(a.id) + '"' : '') + '>' + esc(a.label) + '</button>'
      ).join('') + '</div>' : '') +
      '</div>';
    const timeout = opts.timeout == null ? 5200 : opts.timeout;
    if (timeout > 0) {
      toastTimer = setTimeout(() => {
        if (TOAST_ROOT) TOAST_ROOT.innerHTML = '';
        toastTimer = null;
      }, timeout);
    }
  }

  function clearToast() {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    if (TOAST_ROOT) TOAST_ROOT.innerHTML = '';
  }

  function notifyDesktop(title, body) {
    if (data.settings.notify && bridge.notify) {
      bridge.notify({ title: title, body: body }).catch(function () {});
    }
  }

  function safeRender() {
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    render();
  }

  function render() {
    if (!data) return;
    const currentView = document.getElementById('view');
    if (currentView && lastView === view) scrollMemory[view] = currentView.scrollTop;
    const scroll = scrollMemory[view] || 0;
    ROOT.innerHTML = '<div class="app-shell">' + sidebarHTML() + '<main class="main">' +
      topbarHTML() + '<div class="view" id="view">' + viewHTML() + '</div></main></div>';
    const newView = document.getElementById('view');
    if (newView && lastView === view) newView.scrollTop = scroll;
    if (lastView !== view) scrollMemory[view] = 0;
    lastView = view;
    renderNapcatStatusOnly();
  }

  function sidebarHTML() {
    const pending = inboxPending().length;
    const unclassified = data.sources.filter((s) => s.importance === 'unclassified').length;
    const napcatOnline = napcatStatus.status === 'online';
    const captureText = captureOn ? '自动采集中' : '采集已暂停';
    const captureHint = captureOn ? '复制微信 / QQ 消息，日序会自动识别。' : '开启后，复制消息即可识别。';
    const captureBtn = captureOn ? '暂停' : '开启';
    return '<aside class="sidebar">' +
      '<div class="brand"><div class="brand-mark">日</div><div class="brand-text"><div class="brand-name">日序</div><div class="brand-tagline">把约定收进日程</div></div></div>' +
      '<nav class="nav">' +
      navItem('calendar', 'calendar', '日历', '') +
      navItem('inbox', 'inbox', '待确认', pending) +
      navItem('sources', 'layers', '来源', unclassified, true) +
      navItem('settings', 'settings', '设置', '') +
      '</nav><div class="sidebar-spacer"></div>' +
      '<div class="capture-card"><div class="capture-top"><span class="pulse-dot ' + (captureOn ? 'live' : 'off') + '"></span><span>' + captureText + '</span><span class="muted">' + (IS_DESKTOP ? '本地' : '预览') + '</span></div>' +
      '<p>' + captureHint + '</p>' +
      '<button class="capture-btn" data-action="toggle-capture">' + (IS_DESKTOP ? captureBtn : '仅桌面版可用') + '</button>' +
      (data.settings.napcat.enabled ? '<div class="napcat-mini" id="napcat-mini">' + napcatMiniHTML() + '</div>' : '') +
      '</div>' +
      '<button class="sidebar-paste" data-action="open-paste">' + icon('clipboard', 14) + ' <span>粘贴一条消息</span></button>' +
      '<div class="sidebar-foot">本地运行 · 数据不离开电脑</div>' +
      '</aside>';
  }

  function navItem(target, iconName, label, count, quiet) {
    return '<button class="nav-item ' + (view === target ? 'active' : '') + '" data-action="nav" data-view="' + target + '">' +
      icon(iconName, 16) + '<span>' + label + '</span>' +
      (count ? '<span class="nav-badge ' + (quiet ? 'quiet' : '') + '">' + count + '</span>' : '') +
      '</button>';
  }

  function napcatMiniHTML() {
    const status = napcatStatus.status;
    if (status === 'online') return '<span class="pulse-dot live"></span><span>NapCat 在线 · ' + (napcatStatus.groups || 0) + ' 个群</span>';
    if (status === 'connecting' || status === 'reconnecting') return '<span class="pulse-dot off"></span><span>NapCat 连接中</span>';
    if (status === 'error') return '<span class="pulse-dot off"></span><span>NapCat 连接失败</span>';
    return '<span class="pulse-dot off"></span><span>NapCat 未连接</span>';
  }

  function topbarHTML() {
    if (view === 'calendar') {
      return '<header class="topbar"><div class="month-nav">' +
        '<button class="icon-btn" data-action="prev-month" aria-label="上个月">' + icon('chevron-left', 17) + '</button>' +
        '<button class="month-title" data-action="today" title="回到今天"><span class="month-year">' + monthCursor.getFullYear() + ' 年</span><span class="month-name">' + MONTH_CN[monthCursor.getMonth()] + '</span></button>' +
        '<button class="icon-btn" data-action="next-month" aria-label="下个月">' + icon('chevron-right', 17) + '</button>' +
        '</div><div class="top-actions">' +
        '<button class="btn-ghost" data-action="today">今天</button>' +
        '<button class="btn-ghost" data-action="open-paste">' + icon('clipboard', 13) + ' <span>粘贴消息</span></button>' +
        '<button class="btn-primary" data-action="add-event">' + icon('plus', 13) + ' 新日程</button>' +
        '</div></header>';
    }
    const now = new Date();
    const actions = view === 'settings' ? '' :
      '<div class="top-actions"><button class="btn-ghost" data-action="open-paste">' + icon('clipboard', 13) + ' <span>粘贴消息</span></button>' +
      '<button class="btn-primary" data-action="add-event">' + icon('plus', 13) + ' 新日程</button></div>';
    return '<header class="topbar"><div class="page-top-title"><h1>' + (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日</h1><p>' + weekdayFull(now) + ' · ' + (IS_DESKTOP ? '本地运行' : '浏览器预览') + '</p></div>' + actions + '</header>';
  }

  function viewHTML() {
    if (view === 'inbox') return inboxViewHTML();
    if (view === 'sources') return sourcesViewHTML();
    if (view === 'settings') return settingsViewHTML();
    return calendarViewHTML();
  }

  function eventChipHTML(ev) {
    const tone = eventTone(ev);
    const time = ev.allDay ? '全天' : isoTime(ev.start);
    return '<button class="event-chip ' + tone + '" data-action="open-event" data-id="' + esc(ev.id) + '" title="' +
      esc((ev.allDay ? '全天' : time) + ' ' + ev.title + (ev.location ? ' · ' + ev.location : '')) + '">' +
      '<span class="dot"></span><span class="chip-time">' + esc(time) + '</span><span class="chip-title">' + esc(ev.title) + '</span></button>';
  }

  function calendarViewHTML() {
    const first = startOfMonth(monthCursor);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -offset);
    const pendingDates = new Set(inboxPending().map((i) => i.schedule.date).filter(Boolean));
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const key = dateKey(d);
      const dayEvents = eventsOn(key);
      const outside = d.getMonth() !== monthCursor.getMonth();
      const chips = dayEvents.slice(0, 3).map(eventChipHTML).join('');
      const more = dayEvents.length > 3 ? '<div class="more-events">还有 ' + (dayEvents.length - 3) + ' 项</div>' : '';
      cells += '<div class="day-cell ' + (outside ? 'outside ' : '') + (key === todayKey() ? 'is-today ' : '') +
        (key === selectedDate ? 'selected ' : '') + '" role="button" tabindex="0" data-action="select-day" data-date="' + key +
        '" aria-label="' + esc(relativeDay(key) + '，' + (dayEvents.length ? dayEvents.length + ' 项日程' : '没有安排')) + '">' +
        '<div class="cell-top"><span class="day-num">' + d.getDate() + '</span>' + (pendingDates.has(key) ? '<span class="cell-pending" title="有待确认安排"></span>' : '') + '</div>' +
        '<div class="cell-events">' + chips + more + '</div></div>';
    }
    return '<div class="calendar-view">' +
      (data.meta.demo ? '<div class="demo-banner"><span>演示数据 · 用示例看看日序如何工作</span><button data-action="clear-demo">清空示例</button></div>' : '') +
      '<div class="calendar-layout"><section class="calendar-panel"><div class="weekdays">' +
      ['一', '二', '三', '四', '五', '六', '日'].map((w, i) => '<span class="' + (i > 4 ? 'weekend' : '') + '">周' + w + '</span>').join('') +
      '</div><div class="month-grid">' + cells + '</div></section>' + dayPanelHTML() + '</div></div>';
  }

  function dayPanelHTML() {
    const d = selectedDay();
    const events = eventsOn(selectedDate);
    const pending = inboxPending();
    const agenda = events.length ? '<div class="agenda-list">' + events.map((ev) => {
      const source = sourceById(ev.sourceId);
      const metaParts = [];
      if (ev.location) metaParts.push(esc(ev.location));
      if (ev.sourceName || source) metaParts.push(esc((source && source.name) || ev.sourceName));
      return '<button class="agenda-item" data-action="open-event" data-id="' + esc(ev.id) + '">' +
        '<div class="agenda-time ' + (ev.allDay ? 'all-day' : '') + '">' + (ev.allDay ? '全天' : esc(isoTime(ev.start))) + '</div>' +
        '<div class="agenda-rail"><span class="agenda-dot ' + eventTone(ev) + '"></span></div>' +
        '<div class="agenda-body"><div class="agenda-title">' + esc(ev.title) + '</div>' +
        (metaParts.length ? '<div class="agenda-meta">' + metaParts.join('<span class="sep">·</span>') + '</div>' : '') +
        '</div></button>';
    }).join('') + '</div>' : '<div class="empty-day"><div class="empty-glyph">' + icon('sun', 18) + '</div><p>这一天还没有安排</p><button class="btn-text" data-action="add-event">加一件事</button></div>';

    const mini = pending.length ? '<div class="day-pending"><div class="mini-head"><span>待确认</span><button data-action="nav" data-view="inbox">全部 ' + pending.length + '</button></div>' +
      pending.slice(0, 2).map((item) => '<button class="mini-card" data-action="open-inbox" data-id="' + esc(item.id) + '">' +
        '<div class="mini-when">' + esc(formatScheduleWhen(item.schedule)) + '</div><div class="mini-title">' + esc(item.schedule.title) + '</div></button>').join('') + '</div>' : '';

    return '<aside class="day-panel"><div class="day-head"><div class="day-big">' + d.getDate() + '</div><div class="day-meta"><div class="day-weekday">' + weekdayFull(d) + '</div><div class="day-full">' + fullDateCN(d) + '</div></div></div>' +
      '<div class="agenda-label"><span>安排</span><span>' + events.length + ' 项</span></div>' + agenda + mini + '</aside>';
  }

  /* ---------------- inbox ---------------- */

  function inboxViewHTML() {
    const pending = inboxPending();
    const cards = pending.map(inboxCardHTML).join('');
    return '<div class="page"><div class="page-head"><div><h1>待确认</h1><p>识别到、但还差一点确定性的安排。确认后才会进入日历。</p></div>' +
      '<span class="count-pill">' + pending.length + ' 条待处理</span></div>' +
      (pending.length ? '<div class="inbox-list">' + cards + '</div>' :
        '<div class="empty-state"><div class="empty-icon">' + icon('check', 20) + '</div><h2>没有待确认的安排</h2><p>复制一条带日期和时间的聊天消息，日序会把识别结果先放到这里。</p><button class="btn-ghost" data-action="open-paste">' + icon('clipboard', 13) + ' 粘贴一条消息</button></div>') +
      '</div>';
  }

  function inboxCardHTML(item) {
    const schedule = item.schedule;
    const confClass = confidenceClass(item.confidence);
    const sourceText = item.sourceName || '未知来源';
    const when = formatScheduleWhen(schedule);
    const warnings = [];
    if (schedule.needsDate) warnings.push('日期推测');
    if (schedule.needsTime) warnings.push('时间待补');
    if (schedule.isQuestion) warnings.push('可能是询问');
    return '<article class="inbox-card ' + (item.viaAI ? 'ai' : '') + '">' +
      '<div class="card-top"><div class="source-tag"><span class="platform ' + esc(item.platform) + '">' + platformLabel(item.platform) + '</span><span class="name">' + esc(sourceText) + '</span></div>' +
      '<span class="conf-tag ' + confClass + '">' + confidenceLabel(item.confidence) + ' · ' + Math.round(item.confidence * 100) + '%</span></div>' +
      '<div class="card-when">' + esc(when) + (warnings.length ? ' <span class="dash">/</span> ' + esc(warnings.join(' · ')) : '') + '</div>' +
      '<div class="card-title-row"><h2>' + esc(schedule.title) + '</h2>' + (item.viaAI ? '<span class="ai-tag">AI 辅助</span>' : '') + '</div>' +
      (schedule.location ? '<div class="card-loc">' + icon('link', 11) + ' ' + esc(schedule.location) + '</div>' : '') +
      '<blockquote>' + esc(String(item.text || '').slice(0, 280)) + '</blockquote>' +
      '<div class="card-actions"><button class="btn-primary" data-action="confirm-inbox" data-id="' + esc(item.id) + '">' + icon('check', 12) + ' 加入日程</button>' +
      '<button class="btn-ghost" data-action="edit-inbox" data-id="' + esc(item.id) + '">调整时间</button>' +
      '<button class="btn-text" data-action="ignore-inbox" data-id="' + esc(item.id) + '">忽略</button></div></article>';
  }

  /* ---------------- sources ---------------- */

  function filteredSources() {
    const rank = { important: 0, normal: 1, unclassified: 2, ignored: 3 };
    const query = sourceQuery.trim().toLowerCase();
    return data.sources.filter((source) => {
      if (sourceFilter !== 'all' && source.importance !== sourceFilter) return false;
      if (query && source.name.toLowerCase().indexOf(query) < 0) return false;
      return true;
    }).sort((a, b) => {
      const rd = (rank[a.importance] || 0) - (rank[b.importance] || 0);
      if (rd !== 0) return rd;
      return String(b.lastAt || '').localeCompare(String(a.lastAt || ''));
    });
  }

  function sourcesViewHTML() {
    const counts = { important: 0, normal: 0, unclassified: 0, ignored: 0 };
    data.sources.forEach((s) => { if (counts[s.importance] != null) counts[s.importance] += 1; });
    const filters = [
      ['all', '全部', data.sources.length],
      ['important', '重要', counts.important],
      ['normal', '普通', counts.normal],
      ['unclassified', '待归类', counts.unclassified],
      ['ignored', '已忽略', counts.ignored]
    ];
    return '<div class="page"><div class="page-head"><div><h1>来源</h1><p>标记你在意的群聊和好友。只有重要 / 普通的会话会保存消息摘要并识别日程。</p></div></div>' +
      '<div class="source-summary">' +
      summaryCell(counts.important, '重要会话') + summaryCell(counts.normal, '普通会话') +
      summaryCell(counts.unclassified, '待归类') + summaryCell(counts.ignored, '已忽略') + '</div>' +
      '<div class="source-toolbar">' + filters.map(([value, label, count]) =>
        '<button class="filter-chip ' + (sourceFilter === value ? 'active' : '') + '" data-action="source-filter" data-value="' + value + '">' + label + ' ' + count + '</button>'
      ).join('') +
      (counts.unclassified ? '<button class="filter-chip" data-action="classify-all">全部标为普通</button>' : '') +
      '<input class="source-search" id="source-search" type="search" placeholder="搜索会话…" value="' + esc(sourceQuery) + '" aria-label="搜索会话"></div>' +
      '<div id="source-list">' + sourceListHTML() + '</div></div>';
  }

  function summaryCell(value, label) {
    return '<div class="summary-cell"><strong>' + value + '</strong><span>' + label + '</span></div>';
  }

  function sourceListHTML() {
    const sources = filteredSources();
    if (!sources.length) {
      return '<div class="source-empty">' + (data.sources.length ? '没有符合筛选条件的会话。' : '还没有来源。复制一条微信 / QQ 消息，这里会自动出现会话。') + '</div>';
    }
    const groups = [
      ['wechat', '微信'],
      ['qq', 'QQ'],
      ['unknown', '其他来源']
    ];
    return groups.map(([platform, label]) => {
      const list = sources.filter((s) => s.platform === platform);
      if (!list.length) return '';
      return '<section class="source-group"><div class="group-title"><span>' + label.toUpperCase() + '</span><span class="count">' + list.length + '</span></div>' +
        list.map(sourceRowHTML).join('') + '</section>';
    }).join('');
  }

  function sourceRowHTML(source) {
    const ignored = source.importance === 'ignored';
    const unclassified = source.importance === 'unclassified';
    let snippet = source.lastText || '暂无消息摘要';
    if (ignored) snippet = '已忽略，不保存消息正文';
    if (unclassified) snippet = '待归类，暂不识别内容';
    const sub = kindLabel(source.kind) + ' · ' + relativeTime(source.lastAt) + ' · 已采集 ' + (source.count || 0) + ' 条';
    return '<div class="source-row ' + (unclassified ? 'unclassified' : '') + '">' +
      '<div class="source-avatar ' + esc(source.platform) + '">' + esc(sourceInitial(source)) + '</div>' +
      '<div class="source-main"><div class="source-name"><span class="name">' + esc(source.name) + '</span><span class="platform-tag">' + platformLabel(source.platform) + '</span></div>' +
      '<div class="source-sub">' + (unclassified ? '<span class="needs">待归类</span> · ' : '') + esc(sub) + '</div></div>' +
      '<div class="source-snippet">' + esc(snippet) + '</div>' +
      '<div class="importance-seg" role="group" aria-label="会话重要性">' +
      ['important', 'normal', 'ignored'].map((value) => {
        const label = value === 'important' ? '重要' : value === 'normal' ? '普通' : '忽略';
        return '<button data-action="set-importance" data-id="' + esc(source.id) + '" data-value="' + value + '" class="' + (source.importance === value ? 'active' : '') + '">' + label + '</button>';
      }).join('') + '</div></div>';
  }

  function renderSourceListOnly() {
    const list = document.getElementById('source-list');
    if (list) list.innerHTML = sourceListHTML();
  }

  /* ---------------- settings ---------------- */

  function switchHTML(path, checked) {
    return '<label class="switch"><input type="checkbox" data-setting="' + path + '" ' + (checked ? 'checked' : '') + '><span class="switch-track"></span></label>';
  }

  function selectHTML(path, value, options) {
    return '<select class="select-compact" data-setting="' + path + '">' + options.map(([val, label]) =>
      '<option value="' + esc(val) + '" ' + (String(value) === String(val) ? 'selected' : '') + '>' + esc(label) + '</option>'
    ).join('') + '</select>';
  }

  function napcatStatusLineHTML() {
    const status = napcatStatus.status || 'disabled';
    const labels = {
      disabled: '未启用',
      connecting: '正在连接…',
      online: '已连接' + (napcatStatus.selfId ? ' · ' + (napcatStatus.nickname || napcatStatus.selfId) : '') + (napcatStatus.groups ? ' · ' + napcatStatus.groups + ' 个群 / ' + napcatStatus.friends + ' 个好友' : ''),
      reconnecting: '连接断开，正在重连' + (napcatStatus.attempts ? '（第 ' + napcatStatus.attempts + ' 次）' : ''),
      error: '连接失败',
      idle: '未连接'
    };
    const dot = status === 'online' ? 'online' : status === 'error' ? 'error' : (status === 'connecting' || status === 'reconnecting') ? 'connecting' : '';
    return '<div class="status-line" id="napcat-status-line"><span class="status-dot ' + dot + '"></span><span>' + esc(labels[status] || labels.disabled) + '</span>' +
      (napcatStatus.error ? '<span style="color:var(--accent)">' + esc(napcatStatus.error) + '</span>' : '') + '</div>';
  }

  function settingsViewHTML() {
    const s = data.settings;
    return '<div class="page settings-page"><div class="page-head"><div><h1>设置</h1><p>AI 默认开启，优先用 DeepSeek 理解消息；关闭后完全靠本地规则，不联网。</p></div></div>' +

      '<section class="settings-section"><div class="section-head"><h2>采集</h2><p>默认不读取剪贴板。开启后只处理包含日期、时间或日程关键词的片段。</p></div><div class="settings-body">' +
      settingRow('监听剪贴板', '复制微信 / QQ 消息后自动识别。密码、链接等无日程信号的内容会被忽略。', switchHTML('captureEnabled', captureOn)) +
      settingRow('高置信自动加入', '超过阈值的安排直接进入日历，其余留在待确认。', switchHTML('autoAdd', s.autoAdd)) +
      settingRow('自动加入阈值', '越低越积极，也越容易把不确定的消息放进来。', selectHTML('autoThreshold', s.autoThreshold, [['0.7', '70% · 积极'], ['0.82', '82% · 平衡'], ['0.9', '90% · 谨慎']])) +
      settingRow('关闭窗口后驻留托盘', '保证剪贴板采集不中断。托盘菜单可以随时暂停。', switchHTML('closeToTray', s.closeToTray)) +
      settingRow('开机自启', '登录 Windows 后在后台启动日序。', switchHTML('openAtLogin', s.openAtLogin)) +
      '</div></section>' +

      '<section class="settings-section"><div class="section-head"><h2>提醒</h2><p>在日程开始前用系统通知提醒你。</p></div><div class="settings-body">' +
      settingRow('系统通知', '关闭后仍会出现在日历，但不弹通知。', switchHTML('notify', s.notify)) +
      settingRow('提前提醒', '只对未来的日程生效。', selectHTML('reminderMinutes', s.reminderMinutes, [['0', '开始时'], ['5', '5 分钟前'], ['10', '10 分钟前'], ['15', '15 分钟前'], ['30', '30 分钟前']])) +
      '</div></section>' +

      '<section class="settings-section"><div class="section-head"><h2>实时接入</h2><p>可选。NapCat 的 OneBot WebSocket 能真正实时收到 QQ 消息。</p></div><div class="settings-body">' +
      settingRow('启用 NapCat', '需要单独运行 NapCat，并用一个小号登录。主号与 NapCat 同号可能互踢。', switchHTML('napcat.enabled', s.napcat.enabled)) +
      napcatStatusLineHTML() +
      '<div class="llm-box"><div class="field-grid"><label class="field"><span>WebSocket 地址</span><input class="text-input" data-setting="napcat.url" value="' + esc(s.napcat.url) + '" placeholder="ws://127.0.0.1:3001"></label>' +
      '<label class="field"><span>Token（没有就留空）</span><input class="text-input" type="password" data-setting="napcat.token" value="' + esc(s.napcat.token) + '" placeholder="access token"></label></div>' +
      '<div class="settings-actions"><button class="btn-ghost" data-action="save-napcat">保存并连接</button><button class="btn-text" data-action="reconnect-napcat">立即重连</button></div>' +
      '<p class="llm-note">NapCat 登录的账号能看到它所在群的实时消息。新群默认“待归类”，不会自动识别；请到来源页标记重要/普通。与官方 PC QQ 同号登录通常会互相挤下线。</p></div>' +
      '</div></section>' +

      '<section class="settings-section"><div class="section-head"><h2>AI 识别</h2><p>默认优先用 AI 理解消息；调用失败或模型没把握时，自动回退本地规则。</p></div><div class="settings-body">' +
      settingRow('启用 AI 识别', '关闭后完全离线，只走本地规则。AI 需要你自己的 API Key，可在下方填写或用环境变量 DEEPSEEK_API_KEY 提供。', switchHTML('llm.enabled', s.llm.enabled)) +
      '<div class="llm-box"><div class="field-grid"><label class="field"><span>API 地址</span><input class="text-input" data-setting="llm.baseUrl" value="' + esc(s.llm.baseUrl) + '" placeholder="https://api.deepseek.com/v1"></label>' +
      '<label class="field"><span>模型</span><input class="text-input" data-setting="llm.model" value="' + esc(s.llm.model) + '" placeholder="deepseek-chat"></label></div>' +
      '<label class="field" style="margin-top:9px"><span>API Key</span><input class="text-input" type="password" data-setting="llm.apiKey" value="' + esc(s.llm.apiKey) + '" placeholder="填你自己的 Key，例如 sk-..."></label>' +
      '<div class="settings-actions"><button class="btn-ghost" data-action="test-ai" ' + (aiTesting ? 'disabled' : '') + '>' + (aiTesting ? '测试中…' : '测试连接') + '</button></div>' +
      '<p class="llm-note">' + (s.llm.apiKey ? '已填写本机 Key。' : aiKeyAvailable ? '已检测到环境变量中的 API Key。' : '还没有可用的 Key；不填也能用本地规则识别。') + ' 只有重要 / 普通来源的消息会被发送，忽略和待归类的群不会上传。Key 只保存在本机（数据文件里）。</p></div>' +
      '</div></section>' +

      '<section class="settings-section"><div class="section-head"><h2>数据</h2><p>数据只在这台电脑上。建议偶尔导出备份。</p></div><div class="settings-body">' +
      '<div class="setting-row"><div class="setting-copy"><div class="setting-label">本地数据</div><div class="setting-desc">' + esc(dataPath || '本地存储') + '</div></div>' +
      '<div class="settings-actions"><button class="btn-ghost" data-action="open-data">打开文件夹</button></div></div>' +
      '<div class="setting-row"><div class="setting-copy"><div class="setting-label">备份与迁移</div><div class="setting-desc">导出 JSON，换电脑时再导入。</div></div>' +
      '<div class="settings-actions"><button class="btn-ghost" data-action="export-data">' + icon('download', 12) + ' 导出</button><button class="btn-ghost" data-action="import-data">' + icon('upload', 12) + ' 导入</button></div></div>' +
      '<div class="setting-row"><div class="setting-copy"><div class="setting-label">示例与重置</div><div class="setting-desc">示例数据可以随时清空，不影响真实日历。</div></div>' +
      '<div class="settings-actions"><button class="btn-ghost" data-action="load-demo">载入示例</button><button class="btn-danger" data-action="clear-data">清空全部</button></div></div>' +
      '</div></section>' +

      '<section class="settings-section"><div class="section-head"><h2>关于</h2><p>日序 · 把聊天里的约定，收进日程。</p></div><div class="settings-body">' +
      '<div class="about-block"><strong>本地优先</strong>剪贴板监听、规则识别、日历数据都在本机完成。微信 / QQ 的本地数据库是加密的，日序不做内存注入或解密，因此采用“复制消息即识别”的安全通道；NapCat 接入是可选项。<br><br>' +
      '版本 <code>v' + esc(appVersion) + '</code> · 数据格式 1 · <button class="btn-text" data-action="open-onboarding" style="display:inline;height:auto;padding:0;color:var(--accent)">再看一次使用说明</button></div>' +
      '</div></section></div>';
  }

  function settingRow(label, desc, control) {
    return '<div class="setting-row"><div class="setting-copy"><div class="setting-label">' + esc(label) + '</div><div class="setting-desc">' + esc(desc) + '</div></div>' + control + '</div>';
  }

  /* ---------------- modals ---------------- */

  function renderModal() {
    if (!MODAL_ROOT) return;
    if (!modalState) {
      MODAL_ROOT.innerHTML = '';
      return;
    }
    let html = '';
    if (modalState.type === 'onboarding') html = onboardingModalHTML();
    else if (modalState.type === 'event') html = eventModalHTML(modalState.payload || {});
    else if (modalState.type === 'paste') html = pasteModalHTML(modalState.payload || {});
    else if (modalState.type === 'detail') html = detailModalHTML(modalState.payload || {});
    else if (modalState.type === 'confirm') html = confirmModalHTML(modalState.payload || {});
    MODAL_ROOT.innerHTML = html;
    const focus = MODAL_ROOT.querySelector('[data-autofocus]');
    if (focus) setTimeout(function () { try { focus.focus(); focus.select && focus.select(); } catch (e) { /* ignore */ } }, 30);
  }

  function onboardingModalHTML() {
    return '<div class="modal-backdrop"><div class="modal onboarding">' +
      '<div class="onboard-mark">日</div><h1>把聊天里的约定，<br>收进日程。</h1>' +
      '<p class="lead">老师发的会议、朋友约的饭、群里通知的截止日期——复制那条消息，日序会读懂它。</p>' +
      '<div class="onboard-steps"><div class="onboard-step"><div class="step-num">01</div><div><div class="step-title">复制消息</div><div class="step-desc">在微信 / QQ 里选中文字，按 Ctrl+C。</div></div></div>' +
      '<div class="onboard-step"><div class="step-num">02</div><div><div class="step-title">自动识别</div><div class="step-desc">日期、时间、地点和事件标题。</div></div></div>' +
      '<div class="onboard-step"><div class="step-num">03</div><div><div class="step-title">进入日历</div><div class="step-desc">高置信直接加入，其余先待确认。</div></div></div></div>' +
      '<label class="check-row"><input type="checkbox" id="onboard-capture" checked> 开启剪贴板自动采集（只在本机识别，运行期间生效）</label>' +
      '<label class="check-row"><input type="checkbox" id="onboard-ai" checked> 开启 AI 识别（需填自己的 API Key；不填则只用本地规则）</label>' +
      '<label class="field" style="margin-top:12px"><span>DeepSeek API Key（可选，稍后可在设置里填）</span><input class="text-input" type="password" id="onboard-api-key" value="' + esc(data.settings.llm.apiKey) + '" placeholder="sk-..."></label>' +
      '<div class="onboard-note">不注入微信 / QQ、不解密聊天库。开启 AI 后，重要 / 普通来源的消息片段会发往你配置的 AI 服务（默认 DeepSeek）；忽略和待归类的群不会上传。NapCat 实时接入可在设置中另行开启。</div>' +
      '<div class="modal-actions"><button class="btn-text" data-action="skip-onboarding">先自己看看</button><span class="spacer"></span><button class="btn-ghost" data-action="demo-onboarding">看看示例</button><button class="btn-primary" data-action="start-onboarding">开始使用</button></div>' +
      '</div></div>';
  }

  function sourceOptionsHTML(selected) {
    return '<option value="">手动添加</option>' + data.sources.filter((s) => s.importance !== 'ignored').map((s) =>
      '<option value="' + esc(s.id) + '" ' + (selected === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>'
    ).join('');
  }

  function eventModalHTML(payload) {
    const isEdit = !!payload.id;
    const values = payload.values || {
      title: '', date: selectedDate, time: '09:00', endTime: '10:00', allDay: false, location: '', note: '', sourceId: ''
    };
    return '<div class="modal-backdrop"><div class="modal wide"><div class="modal-head"><div><h2>' + (isEdit ? '编辑日程' : '新日程') + '</h2><p>时间会按本机时区保存，不上传。</p></div>' +
      '<button class="icon-btn" data-action="close-modal" aria-label="关闭">' + icon('x', 16) + '</button></div>' +
      '<form class="modal-form" data-form="event"><input type="hidden" name="id" value="' + esc(payload.id || '') + '"><input type="hidden" name="inboxId" value="' + esc(payload.inboxId || '') + '">' +
      '<label class="form-field"><span>标题</span><input class="text-input" name="title" value="' + esc(values.title) + '" placeholder="例如：家长会" data-autofocus required></label>' +
      '<div class="form-grid"><label class="form-field"><span>日期</span><input class="text-input" type="date" name="date" value="' + esc(values.date) + '" required></label>' +
      '<label class="form-field"><span>开始时间</span><input class="text-input" type="time" name="time" value="' + esc(values.time || '09:00') + '" data-time-field ' + (values.allDay ? 'disabled' : '') + '></label>' +
      '<label class="form-field"><span>结束时间</span><input class="text-input" type="time" name="endTime" value="' + esc(values.endTime || '10:00') + '" data-time-field ' + (values.allDay ? 'disabled' : '') + '></label>' +
      '<label class="form-field"><span>来源</span><select class="select-input" name="sourceId">' + sourceOptionsHTML(values.sourceId) + '</select></label>' +
      '<label class="check-row full"><input type="checkbox" name="allDay" ' + (values.allDay ? 'checked' : '') + '> 全天日程</label>' +
      '<label class="form-field full"><span>地点</span><input class="text-input" name="location" value="' + esc(values.location || '') + '" placeholder="会议室 / 线上 / 留空"></label>' +
      '<label class="form-field full"><span>备注</span><textarea class="text-area" name="note" placeholder="可选">' + esc(values.note || '') + '</textarea></label></div>' +
      '<div class="form-error" hidden></div>' +
      '<div class="modal-actions">' + (payload.id ? '<button type="button" class="btn-danger" data-action="delete-event" data-id="' + esc(payload.id) + '">删除</button>' : '') +
      '<span class="spacer"></span><button type="button" class="btn-ghost" data-action="close-modal">取消</button><button type="submit" class="btn-primary">' + (isEdit ? '保存' : '加入日历') + '</button></div></form></div></div>';
  }

  function pasteModalHTML(payload) {
    return '<div class="modal-backdrop"><div class="modal wide"><div class="modal-head"><div><h2>粘贴一条消息</h2><p>支持直接粘贴微信 / QQ 的多条聊天记录。</p></div>' +
      '<button class="icon-btn" data-action="close-modal" aria-label="关闭">' + icon('x', 16) + '</button></div>' +
      '<form class="modal-form" data-form="paste"><label class="form-field"><span>聊天内容</span><textarea class="text-area" name="text" placeholder="例如：\n张老师：后天上午10点在三楼会议室开会，请准时参加。" data-autofocus>' + esc(payload.text || '') + '</textarea></label>' +
      '<div class="form-grid"><label class="form-field"><span>来源名称（可选）</span><input class="text-input" name="source" value="' + esc(payload.source || '') + '" placeholder="三年二班家长群"></label>' +
      '<label class="form-field"><span>平台</span><select class="select-input" name="platform"><option value="wechat">微信</option><option value="qq">QQ</option><option value="unknown">不确定</option></select></label></div>' +
      '<p class="hint-text">识别只在本机进行。没有明确日期或时间的消息不会进入日历。</p><div class="form-error" ' + (payload.error ? '' : 'hidden') + '>' + esc(payload.error || '') + '</div>' +
      '<div class="modal-actions"><button type="button" class="btn-ghost" data-action="close-modal">取消</button><button type="submit" class="btn-primary">' + icon('sparkles', 13) + ' 识别并加入</button></div></form></div></div>';
  }

  function detailModalHTML(payload) {
    const ev = data.events.find((e) => e.id === payload.id);
    if (!ev) return '<div class="modal-backdrop"><div class="modal detail"><div class="modal-head"><div><h2>日程不存在</h2></div><button class="icon-btn" data-action="close-modal">' + icon('x', 16) + '</button></div></div></div>';
    const source = sourceById(ev.sourceId);
    const date = toDate(ev.start);
    const tags = [];
    if (ev.auto) tags.push('自动加入');
    if (ev.viaAI) tags.push('AI 辅助');
    return '<div class="modal-backdrop"><div class="modal detail"><div class="modal-head"><div><div class="detail-kicker">' + esc(relativeDay(isoDate(ev.start))) + ' · ' + esc(weekdayShort(date)) + '</div>' +
      '<h2 class="detail-title">' + esc(ev.title) + '</h2><div class="detail-time">' + esc(formatEventWhen(ev)) + '</div></div>' +
      '<button class="icon-btn" data-action="close-modal" aria-label="关闭">' + icon('x', 16) + '</button></div>' +
      '<div class="detail-meta">' +
      '<div class="meta-item"><span class="meta-label">来源</span><span>' + esc((source && source.name) || ev.sourceName || '手动添加') + '</span></div>' +
      (ev.location ? '<div class="meta-item"><span class="meta-label">地点</span><span>' + esc(ev.location) + '</span></div>' : '') +
      (tags.length ? '<div class="meta-item"><span class="meta-label">方式</span><span>' + esc(tags.join(' · ')) + '</span></div>' : '') + '</div>' +
      (ev.note ? '<div class="detail-quote">' + esc(ev.note) + '</div>' : '') +
      (ev.rawText ? '<div class="detail-quote">' + esc(ev.rawText) + '</div>' : '') +
      (ev.confidence ? '<div class="confidence-row"><span>识别置信度 ' + Math.round(ev.confidence * 100) + '%</span><span class="confidence-bar"><i style="width:' + Math.round(ev.confidence * 100) + '%"></i></span></div>' : '') +
      '<div class="modal-actions"><button class="btn-text" data-action="delete-event" data-id="' + esc(ev.id) + '">删除</button><span class="spacer"></span><button class="btn-ghost" data-action="edit-event" data-id="' + esc(ev.id) + '">编辑</button><button class="btn-primary" data-action="close-modal">完成</button></div></div></div>';
  }

  function confirmModalHTML(payload) {
    return '<div class="modal-backdrop"><div class="modal detail"><div class="modal-head"><div><h2>' + esc(payload.title || '确认操作') + '</h2><p>' + esc(payload.message || '') + '</p></div>' +
      '<button class="icon-btn" data-action="close-modal" aria-label="关闭">' + icon('x', 16) + '</button></div>' +
      '<div class="modal-actions"><button class="btn-ghost" data-action="close-modal">取消</button><button class="btn-danger" data-action="confirm-modal" data-confirm="' + esc(payload.confirm || '') + '">' + esc(payload.label || '确认') + '</button></div></div></div>';
  }

  /* ---------------- data operations ---------------- */

  function addEventFromSchedule(schedule, source, meta) {
    meta = meta || {};
    const existing = data.events.find((e) => e.start === schedule.start && e.title === schedule.title);
    if (existing) return { event: existing, duplicate: true };
    const event = {
      id: uid('evt'),
      title: schedule.title || '日程',
      start: schedule.start,
      end: schedule.end || localISO(addMinutes(toDate(schedule.start), 60)),
      allDay: !!schedule.allDay,
      location: schedule.location || '',
      sourceId: source ? source.id : '',
      sourceName: source ? source.name : (meta.sourceName || '手动添加'),
      platform: source ? source.platform : 'manual',
      rawText: String(meta.text || schedule.sourceText || '').slice(0, 1000),
      note: String(meta.note || schedule.note || ''),
      confidence: Number(schedule.confidence) || 0,
      viaAI: !!(schedule.viaAI || meta.viaAI),
      auto: !!meta.auto,
      status: 'confirmed',
      reminderSentAt: '',
      createdAt: new Date().toISOString()
    };
    data.events.push(event);
    return { event: event, duplicate: false };
  }

  function openEventModal(event, opts) {
    opts = opts || {};
    let values;
    if (event) {
      values = {
        title: event.title,
        date: isoDate(event.start),
        time: event.allDay ? '09:00' : isoTime(event.start),
        endTime: event.allDay ? '10:00' : isoTime(event.end || event.start),
        allDay: !!event.allDay,
        location: event.location || '',
        note: event.note || '',
        sourceId: event.sourceId || ''
      };
    } else if (opts.inbox) {
      const item = opts.inbox;
      const schedule = item.schedule;
      values = {
        title: schedule.title || '',
        date: schedule.date || isoDate(schedule.start),
        time: schedule.time || isoTime(schedule.start) || '09:00',
        endTime: schedule.end ? isoTime(schedule.end) : '10:00',
        allDay: !!schedule.allDay,
        location: schedule.location || '',
        note: schedule.note || '',
        sourceId: item.sourceId || ''
      };
    } else {
      values = {
        title: '',
        date: opts.date || selectedDate,
        time: opts.time || '09:00',
        endTime: opts.endTime || '10:00',
        allDay: false,
        location: '',
        note: '',
        sourceId: opts.sourceId || ''
      };
    }
    openModal({
      type: 'event',
      payload: {
        id: event ? event.id : '',
        inboxId: opts.inbox ? opts.inbox.id : '',
        values: values
      }
    });
  }

  function openDetail(id) {
    const event = data.events.find((e) => e.id === id);
    if (!event) return;
    openModal({ type: 'detail', payload: { id: id } });
  }

  async function openPasteModal() {
    let text = '';
    if (IS_DESKTOP && !IS_SCREENSHOT) {
      try {
        const clip = await bridge.takeClipboard();
        if (clip && clip.ok && P.looksScheduleLike(clip.text)) text = clip.text;
      } catch { /* ignore */ }
    }
    openModal({ type: 'paste', payload: { text: text } });
  }

  function confirmInboxItem(id) {
    const item = data.inbox.find((i) => i.id === id && i.status === 'pending');
    if (!item) return;
    const source = sourceById(item.sourceId) || { id: item.sourceId, name: item.sourceName, platform: item.platform };
    const result = addEventFromSchedule(item.schedule, source, { text: item.text, viaAI: item.viaAI, auto: false });
    data.inbox = data.inbox.filter((i) => i.id !== id);
    const date = item.schedule.date || isoDate(item.schedule.start);
    selectedDate = date;
    monthCursor = startOfMonth(parseKey(date));
    view = 'calendar';
    closeModal();
    saveNow();
    render();
    if (result.duplicate) {
      showToast({ title: '这个日程已经在日历里', body: result.event.title, timeout: 3200 });
    } else {
      showToast({
        title: '已加入日历',
        body: formatScheduleWhen(item.schedule) + ' · ' + item.schedule.title,
        actions: [{ label: '查看', action: 'open-event', id: result.event.id }, { label: '撤销', action: 'undo-auto', id: result.event.id, quiet: true }]
      });
    }
  }

  function ignoreInboxItem(id) {
    const item = data.inbox.find((i) => i.id === id && i.status === 'pending');
    if (!item) return;
    item.status = 'ignored';
    lastDeleted = null;
    saveSoon();
    render();
    showToast({
      title: '已忽略',
      body: item.schedule.title,
      actions: [{ label: '撤销', action: 'undo-ignore', id: id, quiet: true }]
    });
  }

  function dropEvent(id) {
    const index = data.events.findIndex((e) => e.id === id);
    if (index < 0) return;
    const event = data.events[index];
    data.events.splice(index, 1);
    lastDeleted = { event: event, index: index };
    closeModal();
    saveNow();
    render();
    showToast({
      title: '已删除日程',
      body: event.title,
      actions: [{ label: '撤销', action: 'undo-delete', id: event.id, quiet: true }]
    });
  }

  function undoDelete() {
    if (!lastDeleted) return;
    const index = Math.max(0, Math.min(lastDeleted.index, data.events.length));
    data.events.splice(index, 0, lastDeleted.event);
    const title = lastDeleted.event.title;
    lastDeleted = null;
    saveNow();
    render();
    showToast({ title: '已恢复', body: title, timeout: 3000 });
  }

  function undoAuto(id) {
    const index = data.events.findIndex((e) => e.id === id);
    if (index < 0) return;
    const event = data.events[index];
    const source = sourceById(event.sourceId);
    const schedule = {
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      date: isoDate(event.start),
      time: event.allDay ? null : isoTime(event.start),
      location: event.location,
      confidence: event.confidence || 0.7,
      needsDate: false,
      needsTime: !!event.allDay,
      reasons: ['手动撤销'],
      sourceText: event.rawText
    };
    data.events.splice(index, 1);
    data.inbox.unshift({
      id: uid('inbox'),
      sourceId: event.sourceId,
      sourceName: event.sourceName,
      platform: event.platform,
      sender: '',
      text: event.rawText || event.title,
      receivedAt: new Date().toISOString(),
      schedule: schedule,
      viaAI: !!event.viaAI,
      confidence: schedule.confidence,
      status: 'pending'
    });
    saveNow();
    render();
    showToast({ title: '已撤销，移到待确认', body: event.title, timeout: 3600 });
  }

  function setSourceImportance(id, importance) {
    const source = sourceById(id);
    if (!source) return;
    const wasUnclassified = source.importance === 'unclassified';
    source.importance = importance;
    if (importance === 'ignored') source.lastText = '';
    saveSoon();
    render();
    if (wasUnclassified && importance !== 'unclassified') {
      showToast({ title: '已归类', body: '后续来自「' + source.name + '」的消息会开始识别。', timeout: 3200 });
    }
  }

  function upsertNapcatSources(payload) {
    if (!payload) return;
    const list = (payload.groups || []).map((g) => ({
      externalId: g.externalId || ('qq-group-' + g.group_id),
      name: g.name || g.group_name || 'QQ群',
      kind: 'group',
      memberCount: g.memberCount || g.member_count || 0
    })).concat((payload.friends || []).map((f) => ({
      externalId: f.externalId || ('qq-friend-' + f.user_id),
      name: f.name || f.nickname || 'QQ好友',
      kind: 'friend',
      memberCount: 0
    })));
    let created = 0;
    list.forEach((item) => {
      if (!item.externalId) return;
      let source = findSource(item.externalId, '', 'qq');
      if (!source) {
        source = ensureSource({
          externalId: item.externalId,
          platform: 'qq',
          name: item.name,
          kind: item.kind,
          memberCount: item.memberCount,
          importance: 'unclassified'
        });
        created += 1;
      } else {
        if (item.name && (!source.name || /^QQ(?:群|好友) /.test(source.name))) source.name = item.name;
        if (item.memberCount) source.memberCount = item.memberCount;
      }
    });
    saveSoon();
    safeRender();
    if (!napcatSyncedThisSession) {
      napcatSyncedThisSession = true;
      showToast({
        title: 'NapCat 已同步来源',
        body: (payload.groups || []).length + ' 个群 · ' + (payload.friends || []).length + ' 个好友。先标记重要会话。',
        actions: [{ label: '去来源', action: 'nav-sources' }],
        timeout: 6500
      });
    } else if (created && view === 'sources') {
      renderSourceListOnly();
    }
  }

  function renderNapcatStatusOnly() {
    const mini = document.getElementById('napcat-mini');
    if (mini) mini.innerHTML = napcatMiniHTML();
    const line = document.getElementById('napcat-status-line');
    if (line) line.outerHTML = napcatStatusLineHTML();
  }

  async function applyNapcatConfig(showFeedback) {
    if (!IS_DESKTOP) {
      if (showFeedback) showToast({ type: 'error', title: '浏览器预览不支持 NapCat', body: '请用桌面版连接。' });
      return;
    }
    if (!data.settings.napcat.url) data.settings.napcat.url = 'ws://127.0.0.1:3001';
    try {
      const status = await bridge.napcatConfigure(data.settings.napcat);
      if (status) {
        const previous = napcatStatus.status;
        napcatStatus = Object.assign({}, napcatStatus, status);
        renderNapcatStatusOnly();
        if (showFeedback) {
          if (status.status === 'online') {
            showToast({ title: 'NapCat 已连接', body: (status.groups || 0) + ' 个群 · ' + (status.friends || 0) + ' 个好友', actions: [{ label: '去来源', action: 'nav-sources' }] });
          } else if (status.status === 'error') {
            showToast({ type: 'error', title: 'NapCat 连接失败', body: status.error || '请检查地址和 Token。' });
          } else if (status.status === 'disabled') {
            showToast({ title: 'NapCat 已断开', body: '剪贴板采集不受影响。', timeout: 3000 });
          } else if (previous !== status.status) {
            showToast({ title: '正在连接 NapCat', body: '连上后会自动同步群和好友列表。', timeout: 3000 });
          }
        }
      }
    } catch (err) {
      if (showFeedback) showToast({ type: 'error', title: 'NapCat 连接失败', body: String(err && err.message || err) });
    }
  }

  function aiReady() {
    return !!(data.settings.llm.enabled && bridge.aiExtract && (data.settings.llm.apiKey || aiKeyAvailable));
  }

  async function runAI(text) {
    try {
      const result = await bridge.aiExtract({ text: text, config: data.settings.llm });
      if (result && result.ok) return result.schedule || null;
      if (result && !result.ok && Date.now() - lastAIErrorAt > 60000) {
        lastAIErrorAt = Date.now();
        showToast({ type: 'error', title: 'AI 识别失败', body: result.error || '已使用本地规则' });
      }
    } catch (err) {
      if (Date.now() - lastAIErrorAt > 60000) {
        lastAIErrorAt = Date.now();
        showToast({ type: 'error', title: 'AI 识别失败', body: String(err && err.message || err) });
      }
    }
    return null;
  }

  const unclassifiedToastAt = {};

  async function ingest(opts) {
    opts = opts || {};
    const raw = P.normalizeText(opts.text || '');
    if (!raw) return { added: 0, pending: 0, ignored: 0, noSchedule: 1, error: '消息为空' };
    if (!opts.force && !opts.copyEvent) {
      const h = hashString(raw);
      if (data.meta.hashes && data.meta.hashes.includes(h)) {
        return { added: 0, pending: 0, ignored: 0, noSchedule: 0, duplicate: true };
      }
      rememberHash(h);
    } else {
      // 一次真实的复制动作允许重复入历：删错了重新复制就能加回来。
      rememberHash(hashString(raw));
    }

    const parsed = P.parseMessages(raw, {
      platform: opts.platform && opts.platform !== 'unknown' ? opts.platform : undefined,
      channelName: opts.channelName || ''
    });
    const basePlatform = opts.platform && opts.platform !== 'unknown' ? opts.platform : parsed.platform;
    const messages = parsed.messages.slice(0, 4);
    const atISO = opts.atISO || new Date().toISOString();
    let added = 0;
    let pending = 0;
    let ignored = 0;
    let noSchedule = 0;
    let addedEvent = null;
    let skippedSource = null;

    for (const message of messages) {
      const text = String(message.text || '').trim();
      if (!text) continue;
      const sourceName = opts.channelName || message.channelName || message.sender || (basePlatform === 'qq' ? 'QQ 剪贴板' : basePlatform === 'wechat' ? '微信剪贴板' : '剪贴板片段');
      const externalId = opts.externalId || ('clip-' + hashString(basePlatform + '|' + sourceName));
      let source = findSource(externalId, sourceName, basePlatform);

      if (source && source.importance === 'ignored') {
        source.lastAt = atISO;
        source.count = (source.count || 0) + 1;
        source.lastText = '';
        ignored += 1;
        skippedSource = source;
        continue;
      }
      if (source && source.importance === 'unclassified') {
        source.lastAt = atISO;
        source.count = (source.count || 0) + 1;
        source.lastText = '';
        ignored += 1;
        skippedSource = source;
        continue;
      }
      if (!source && opts.origin === 'napcat') {
        source = ensureSource({
          externalId: externalId,
          platform: basePlatform,
          name: sourceName,
          kind: opts.kind || message.kind || 'unknown',
          importance: 'unclassified'
        });
        source.lastAt = atISO;
        source.count = 1;
        source.lastText = '';
        ignored += 1;
        skippedSource = source;
        continue;
      }

      let schedule = P.extractSchedule(text, { now: new Date() });
      let viaAI = false;
      if (aiReady()) {
        const aiSchedule = await runAI(text);
        if (aiSchedule) {
          if (schedule && schedule.confidence >= 0.9 && aiSchedule.confidence < schedule.confidence) {
            viaAI = false;
          } else {
            schedule = aiSchedule;
            viaAI = true;
          }
        }
      }

      if (!schedule) {
        noSchedule += 1;
        if (opts.origin !== 'manual') {
          source = ensureSource({
            externalId: externalId,
            platform: basePlatform,
            name: sourceName,
            kind: opts.kind || message.kind || 'unknown',
            importance: 'normal'
          });
          source.lastAt = atISO;
          source.count = (source.count || 0) + 1;
          source.lastText = text.slice(0, 80);
        }
        continue;
      }

      source = ensureSource({
        externalId: externalId,
        platform: basePlatform,
        name: sourceName,
        kind: opts.kind || message.kind || 'unknown',
        importance: opts.origin === 'napcat' ? 'unclassified' : 'normal'
      });
      source.lastAt = atISO;
      source.count = (source.count || 0) + 1;
      source.lastText = text.slice(0, 80);
      schedule.sourceText = text;
      if (viaAI) schedule.viaAI = true;

      if (data.settings.autoAdd && schedule.confidence >= data.settings.autoThreshold) {
        const result = addEventFromSchedule(schedule, source, {
          text: text,
          sender: message.sender,
          at: atISO,
          viaAI: viaAI,
          auto: true
        });
        if (!result.duplicate) {
          added += 1;
          if (!addedEvent) addedEvent = result.event;
        }
      } else {
        const duplicated = data.inbox.some((i) => i.status === 'pending' && i.schedule.start === schedule.start && i.schedule.title === schedule.title);
        if (!duplicated) {
          data.inbox.unshift({
            id: uid('inbox'),
            sourceId: source.id,
            sourceName: source.name,
            platform: source.platform,
            sender: message.sender || '',
            text: text,
            receivedAt: atISO,
            schedule: schedule,
            viaAI: viaAI,
            confidence: schedule.confidence,
            status: 'pending'
          });
          pending += 1;
        }
      }
    }

    saveSoon();
    safeRender();

    if (addedEvent) {
      showToast({
        title: '已加入日历',
        body: formatScheduleWhen(addedEvent) + ' · ' + addedEvent.title,
        actions: [{ label: '查看', action: 'open-event', id: addedEvent.id }, { label: '撤销', action: 'undo-auto', id: addedEvent.id, quiet: true }]
      });
      if (!document.hasFocus()) notifyDesktop('已加入日程', formatScheduleWhen(addedEvent) + ' · ' + addedEvent.title);
    } else if (pending > 0) {
      showToast({
        title: '发现一个安排',
        body: '已放入待确认，确认后再进入日历。',
        actions: [{ label: '去确认', action: 'nav-inbox' }]
      });
    } else if (skippedSource && skippedSource.importance === 'unclassified') {
      const last = unclassifiedToastAt[skippedSource.id] || 0;
      if (Date.now() - last > 10 * 60000) {
        unclassifiedToastAt[skippedSource.id] = Date.now();
        showToast({
          title: '「' + skippedSource.name + '」待归类',
          body: '已跳过识别。到来源页标记重要/普通后，后续消息会自动识别。',
          actions: [{ label: '去标记', action: 'nav-sources' }]
        });
      }
    } else if (noSchedule && opts.origin === 'manual') {
      return { added: 0, pending: 0, ignored: ignored, noSchedule: noSchedule, error: '没有识别到明确的时间或安排。请补上日期、时间，或直接新建日程。' };
    } else if (noSchedule && opts.origin === 'clipboard') {
      showToast({ title: '已捕获消息，但没有识别出日程', body: '可以补上日期和时间，或手动新建。', timeout: 3600 });
    }

    return { added: added, pending: pending, ignored: ignored, noSchedule: noSchedule, event: addedEvent };
  }

  /* ---------------- reminders ---------------- */

  function startReminderTimer() {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = null;
    if (!data.settings.notify || !IS_DESKTOP) return;
    reminderTimer = setInterval(checkReminders, 45000);
    setTimeout(checkReminders, 2200);
  }

  function checkReminders() {
    if (!data || !data.settings.notify || data.meta.demo) return;
    const now = Date.now();
    const lead = Math.max(0, Number(data.settings.reminderMinutes) || 0) * 60000;
    let changed = false;
    data.events.forEach((event) => {
      if (event.reminderSentAt) return;
      const start = toDate(event.start).getTime();
      if (isNaN(start)) return;
      const diff = start - now;
      const windowMs = lead > 0 ? lead : 60000;
      if (diff > 0 && diff <= windowMs) {
        event.reminderSentAt = new Date().toISOString();
        changed = true;
        notifyDesktop('日程提醒 · ' + event.title, formatEventWhen(event));
      }
    });
    if (changed) saveSoon();
  }

  /* ---------------- settings ---------------- */

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  }

  function handleSettingInput(el) {
    const path = el.getAttribute('data-setting');
    if (!path) return;
    setPath(data.settings, path, el.value);
    saveSoon();
  }

  function handleSettingChange(el) {
    const path = el.getAttribute('data-setting');
    if (!path) return;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (path === 'autoThreshold') value = parseFloat(el.value);
    else if (path === 'reminderMinutes') value = parseInt(el.value, 10);
    else value = el.value;

    if (path === 'llm.enabled' && value && !data.settings.llm.apiKey && !aiKeyAvailable) {
      showToast({
        title: 'AI 已开启，但还没有 Key',
        body: '本地规则仍会工作；到下方填写 Key 后即可用 AI 识别。',
        timeout: 5000
      });
    }
    setPath(data.settings, path, value);

    if (path === 'captureEnabled') {
      captureOn = !!value;
      if (IS_DESKTOP) bridge.setCaptureEnabled(captureOn).catch(function () {});
      showToast({
        title: captureOn ? '自动采集已开启' : '自动采集已暂停',
        body: captureOn ? '复制含日期或时间的聊天消息即可识别。' : '仍可手动粘贴消息。',
        timeout: 3000
      });
      render();
    } else if (path === 'notify') {
      if (value) startReminderTimer();
      else if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
    } else if (path === 'closeToTray') {
      if (IS_DESKTOP) bridge.setCloseToTray(!!value).catch(function () {});
    } else if (path === 'openAtLogin') {
      if (IS_DESKTOP) bridge.setLoginItem(!!value).catch(function () {});
    } else if (path === 'napcat.enabled') {
      applyNapcatConfig(true);
      render();
    } else if (path === 'autoThreshold') {
      // no layout change needed
    }
    saveSoon();
  }

  /* ---------------- forms ---------------- */

  function formError(form, message) {
    const el = form.querySelector('.form-error');
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
  }

  async function submitPasteForm(form) {
    const fd = new FormData(form);
    const text = String(fd.get('text') || '').trim();
    if (!text) {
      formError(form, '先粘贴一条消息。');
      return;
    }
    const result = await ingest({
      text: text,
      platform: String(fd.get('platform') || 'unknown'),
      channelName: String(fd.get('source') || ''),
      origin: 'manual',
      force: true
    });
    if (result.error) {
      formError(form, result.error);
      return;
    }
    closeModal();
    if (result.added > 0) {
      view = 'calendar';
      if (result.event) {
        selectedDate = isoDate(result.event.start);
        monthCursor = startOfMonth(parseKey(selectedDate));
      }
    } else {
      view = 'inbox';
    }
    render();
  }

  function submitEventForm(form) {
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim();
    const date = String(fd.get('date') || '');
    const allDay = form.querySelector('[name="allDay"]').checked;
    const time = allDay ? '09:00' : String(fd.get('time') || '09:00');
    const endTime = allDay ? '10:00' : String(fd.get('endTime') || '10:00');
    if (!title) {
      formError(form, '给这件事一个标题。');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      formError(form, '日期格式不对。');
      return;
    }
    const start = new Date(date + 'T' + time);
    let end = new Date(date + 'T' + endTime);
    if (isNaN(start.getTime())) {
      formError(form, '时间格式不对。');
      return;
    }
    if (isNaN(end.getTime()) || end <= start) end = addMinutes(start, 60);

    const id = String(fd.get('id') || '');
    const inboxId = String(fd.get('inboxId') || '');
    const sourceId = String(fd.get('sourceId') || '');
    const source = sourceById(sourceId);
    const location = String(fd.get('location') || '').trim();
    const note = String(fd.get('note') || '').trim();

    let event;
    if (id) {
      event = data.events.find((e) => e.id === id);
      if (!event) {
        formError(form, '这个日程已经不存在。');
        return;
      }
      const oldStart = event.start;
      event.title = title;
      event.start = localISO(start);
      event.end = localISO(end);
      event.allDay = allDay;
      event.location = location;
      event.note = note;
      event.sourceId = source ? source.id : '';
      event.sourceName = source ? source.name : '手动添加';
      event.platform = source ? source.platform : 'manual';
      if (oldStart !== event.start) event.reminderSentAt = '';
    } else {
      event = {
        id: uid('evt'),
        title: title,
        start: localISO(start),
        end: localISO(end),
        allDay: allDay,
        location: location,
        sourceId: source ? source.id : '',
        sourceName: source ? source.name : '手动添加',
        platform: source ? source.platform : 'manual',
        rawText: '',
        note: note,
        confidence: 1,
        viaAI: false,
        auto: false,
        status: 'confirmed',
        reminderSentAt: '',
        createdAt: new Date().toISOString()
      };
      data.events.push(event);
    }

    if (inboxId) data.inbox = data.inbox.filter((i) => i.id !== inboxId);
    selectedDate = date;
    monthCursor = startOfMonth(parseKey(date));
    view = 'calendar';
    closeModal();
    saveNow();
    render();
    showToast({ title: id ? '日程已更新' : '已加入日历', body: title + ' · ' + formatEventWhen(event), timeout: 3600 });
  }

  /* ---------------- boot & events ---------------- */

  function getPath(obj, path) {
    let cur = obj;
    for (const part of path.split('.')) {
      if (!cur) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  function onClick(event) {
    if (event.target.classList && event.target.classList.contains('modal-backdrop')) {
      closeModal();
      return;
    }
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    const id = el.getAttribute('data-id');
    switch (action) {
      case 'nav':
        view = el.getAttribute('data-view') || 'calendar';
        render();
        break;
      case 'nav-inbox':
        view = 'inbox';
        render();
        break;
      case 'nav-sources':
        view = 'sources';
        render();
        break;
      case 'prev-month':
        shiftMonth(-1);
        break;
      case 'next-month':
        shiftMonth(1);
        break;
      case 'today':
        selectedDate = todayKey();
        monthCursor = startOfMonth(new Date());
        render();
        break;
      case 'select-day': {
        const key = el.getAttribute('data-date');
        if (!key) return;
        selectedDate = key;
        const d = parseKey(key);
        if (d.getMonth() !== monthCursor.getMonth() || d.getFullYear() !== monthCursor.getFullYear()) {
          monthCursor = startOfMonth(d);
        }
        render();
        break;
      }
      case 'add-event':
        openEventModal(null);
        break;
      case 'open-paste':
        openPasteModal();
        break;
      case 'toggle-capture':
        if (!IS_DESKTOP) {
          showToast({ type: 'error', title: '浏览器预览不能监听剪贴板', body: '请用桌面版启动日序。' });
          break;
        }
        captureOn = !captureOn;
        data.settings.captureEnabled = captureOn;
        bridge.setCaptureEnabled(captureOn).catch(function () {});
        saveSoon();
        render();
        showToast({ title: captureOn ? '自动采集已开启' : '自动采集已暂停', body: captureOn ? '复制含日期或时间的消息试试。' : '仍可手动粘贴。', timeout: 3000 });
        break;
      case 'open-event':
        if (id) openDetail(id);
        break;
      case 'open-inbox':
        view = 'inbox';
        render();
        break;
      case 'confirm-inbox':
        if (id) confirmInboxItem(id);
        break;
      case 'edit-inbox': {
        const item = data.inbox.find((i) => i.id === id);
        if (item) openEventModal(null, { inbox: item });
        break;
      }
      case 'ignore-inbox':
        if (id) ignoreInboxItem(id);
        break;
      case 'set-importance':
        if (id) setSourceImportance(id, el.getAttribute('data-value'));
        break;
      case 'source-filter':
        sourceFilter = el.getAttribute('data-value') || 'all';
        render();
        break;
      case 'classify-all':
        data.sources.forEach((s) => { if (s.importance === 'unclassified') s.importance = 'normal'; });
        saveNow();
        render();
        showToast({ title: '已全部标为普通', body: '之后可以再把真正重要的群标为重要。', timeout: 3200 });
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'delete-event':
        if (id) dropEvent(id);
        break;
      case 'edit-event': {
        const ev = data.events.find((e) => e.id === id);
        if (ev) openEventModal(ev);
        break;
      }
      case 'undo-auto':
        if (id) undoAuto(id);
        break;
      case 'undo-delete':
        undoDelete();
        break;
      case 'undo-ignore': {
        const item = data.inbox.find((i) => i.id === id);
        if (item) { item.status = 'pending'; saveNow(); render(); showToast({ title: '已恢复', body: item.schedule.title, timeout: 3000 }); }
        break;
      }
      case 'save-napcat':
        applyNapcatConfig(true);
        break;
      case 'reconnect-napcat':
        if (IS_DESKTOP) {
          bridge.napcatReconnect().then((status) => {
            if (status) { napcatStatus = Object.assign({}, napcatStatus, status); renderNapcatStatusOnly(); }
            showToast({ title: '正在重连 NapCat', body: '状态会显示在上方。', timeout: 3000 });
          }).catch(function () {});
        }
        break;
      case 'test-ai':
        testAI();
        break;
      case 'open-data':
        if (!IS_DESKTOP) { showToast({ title: '浏览器预览', body: '数据保存在 localStorage。', timeout: 3000 }); break; }
        bridge.openDataFolder().then((result) => {
          if (result && result !== '') showToast({ type: 'error', title: '打开失败', body: result });
        }).catch(function () {});
        break;
      case 'export-data':
        exportData();
        break;
      case 'import-data':
        importData();
        break;
      case 'load-demo':
        openModal({ type: 'confirm', payload: { title: '载入示例数据？', message: '会替换当前所有日程、来源和待确认内容。', confirm: 'load-demo', label: '载入示例' } });
        break;
      case 'clear-data':
        openModal({ type: 'confirm', payload: { title: '清空全部数据？', message: '日程、来源、待确认和消息摘要都会被删除。设置会保留。', confirm: 'clear-data', label: '清空' } });
        break;
      case 'clear-demo':
        openModal({ type: 'confirm', payload: { title: '清空示例数据？', message: '演示用的日程和来源会被移除，设置保留。', confirm: 'clear-demo', label: '清空示例' } });
        break;
      case 'confirm-modal':
        runConfirm(el.getAttribute('data-confirm'));
        break;
      case 'open-onboarding':
        openModal({ type: 'onboarding' });
        break;
      case 'start-onboarding': {
        const check = document.getElementById('onboard-capture');
        const aiCheck = document.getElementById('onboard-ai');
        const keyInput = document.getElementById('onboard-api-key');
        captureOn = !!(check && check.checked);
        data.settings.captureEnabled = captureOn;
        data.settings.llm.enabled = !!(aiCheck && aiCheck.checked);
        if (keyInput && keyInput.value.trim()) {
          data.settings.llm.apiKey = keyInput.value.trim();
          aiKeyAvailable = true;
        }
        data.meta.onboarded = true;
        if (IS_DESKTOP) bridge.setCaptureEnabled(captureOn).catch(function () {});
        saveNow();
        closeModal();
        render();
        showToast({
          title: captureOn ? '自动采集已开启' : '已进入日序',
          body: captureOn ? '复制一条含时间的聊天消息试试。' : '可以随时在设置里开启采集。',
          timeout: 3600
        });
        break;
      }
      case 'skip-onboarding':
        data.meta.onboarded = true;
        saveNow();
        closeModal();
        render();
        break;
      case 'demo-onboarding': {
        const settings = clone(data.settings);
        data = seedDemo();
        data.settings = settings;
        data.meta.onboarded = true;
        saveNow();
        closeModal();
        view = 'calendar';
        render();
        showToast({ title: '示例已载入', body: '这些是虚构的聊天和日程，可随时清空。', timeout: 3600 });
        break;
      }
      default:
        break;
    }
  }

  function shiftMonth(delta) {
    const d = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1);
    monthCursor = d;
    const day = Math.min(parseInt(selectedDate.slice(8, 10), 10) || 1, daysInMonth(d));
    selectedDate = dateKey(new Date(d.getFullYear(), d.getMonth(), day));
    render();
  }

  async function testAI() {
    if (!IS_DESKTOP) {
      showToast({ type: 'error', title: '浏览器预览不支持 AI 调用', body: '请用桌面版。' });
      return;
    }
    if (!data.settings.llm.apiKey && !aiKeyAvailable) {
      showToast({ type: 'error', title: '还没有可用的 Key', body: '在设置里填写 API Key，或设置环境变量 DEEPSEEK_API_KEY 后重启应用。' });
      return;
    }
    aiTesting = true;
    const btn = document.querySelector('[data-action="test-ai"]');
    if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
    try {
      const result = await bridge.aiExtract({ text: '明天上午10点在三楼会议室开会。', config: data.settings.llm });
      if (result && result.ok) {
        showToast({ title: 'AI 连接正常', body: result.schedule ? '识别到：' + result.schedule.title + ' · ' + result.schedule.start.slice(0, 16).replace('T', ' ') : '服务可访问。', timeout: 5000 });
      } else {
        showToast({ type: 'error', title: 'AI 连接失败', body: (result && result.error) || '请检查地址、模型和 Key。' });
      }
    } catch (err) {
      showToast({ type: 'error', title: 'AI 连接失败', body: String(err && err.message || err) });
    } finally {
      aiTesting = false;
      if (btn) { btn.disabled = false; btn.textContent = '测试连接'; }
    }
  }

  async function exportData() {
    if (IS_DESKTOP) {
      try {
        const result = await bridge.exportData(data);
        if (result && result.ok) showToast({ title: '已导出', body: result.path || '', timeout: 4000 });
      } catch (err) {
        showToast({ type: 'error', title: '导出失败', body: String(err && err.message || err) });
      }
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '日序备份.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast({ title: '已导出', body: '日序备份.json', timeout: 3000 });
  }

  async function importData() {
    if (!IS_DESKTOP) {
      showToast({ type: 'error', title: '浏览器预览不支持导入', body: '请用桌面版。' });
      return;
    }
    try {
      const result = await bridge.importData();
      if (!result || !result.ok) return;
      data = normalizeData(result.data);
      data.meta.onboarded = true;
      dataPath = result.path || dataPath;
      saveNow();
      render();
      showToast({ title: '已导入', body: data.events.length + ' 项日程 · ' + data.sources.length + ' 个来源' });
    } catch (err) {
      showToast({ type: 'error', title: '导入失败', body: '文件不是有效的日序备份。' });
    }
  }

  function runConfirm(confirm) {
    if (!confirm) return;
    if (confirm === 'clear-data' || confirm === 'clear-demo') {
      const settings = clone(data.settings);
      data = createEmptyData();
      data.settings = settings;
      data.meta.onboarded = true;
      data.meta.demo = false;
      view = 'calendar';
      selectedDate = todayKey();
      monthCursor = startOfMonth(new Date());
      closeModal();
      saveNow();
      render();
      showToast({ title: confirm === 'clear-demo' ? '示例已清空' : '数据已清空', body: '设置保留。', timeout: 3000 });
    } else if (confirm === 'load-demo') {
      const settings = clone(data.settings);
      data = seedDemo();
      data.settings = settings;
      view = 'calendar';
      selectedDate = todayKey();
      monthCursor = startOfMonth(new Date());
      closeModal();
      saveNow();
      render();
      showToast({ title: '示例已载入', body: '这些是虚构的聊天和日程。', timeout: 3200 });
    }
  }

  function onSubmit(event) {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const type = form.getAttribute('data-form');
    if (type === 'paste') {
      submitPasteForm(form).catch((err) => formError(form, String(err && err.message || err)));
    } else if (type === 'event') {
      try { submitEventForm(form); } catch (err) { formError(form, String(err && err.message || err)); }
    }
  }

  function onChange(event) {
    const el = event.target;
    if (el.matches('[data-setting]')) {
      handleSettingChange(el);
      return;
    }
    if (el.name === 'allDay' && el.form && el.form.getAttribute('data-form') === 'event') {
      const fields = el.form.querySelectorAll('[data-time-field]');
      fields.forEach((f) => { f.disabled = el.checked; });
    }
  }

  function onInput(event) {
    const el = event.target;
    if (el.id === 'source-search') {
      sourceQuery = el.value;
      renderSourceListOnly();
      return;
    }
    if (el.matches('[data-setting]')) handleSettingInput(el);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && modalState) {
      event.preventDefault();
      closeModal();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v' && !modalState) {
      event.preventDefault();
      openPasteModal();
      return;
    }
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    if (modalState) return;
    if (event.key === 'ArrowLeft') { shiftMonth(-1); event.preventDefault(); }
    else if (event.key === 'ArrowRight') { shiftMonth(1); event.preventDefault(); }
    else if (event.key.toLowerCase() === 'n') { openEventModal(null); event.preventDefault(); }
    else if (event.key.toLowerCase() === 'p') { openPasteModal(); event.preventDefault(); }
    else if (event.key.toLowerCase() === 't') { selectedDate = todayKey(); monthCursor = startOfMonth(new Date()); render(); event.preventDefault(); }
    else if (event.key === 'Enter') {
      const cell = event.target.closest && event.target.closest('.day-cell');
      if (cell) {
        selectedDate = cell.getAttribute('data-date');
        render();
        event.preventDefault();
      }
    }
  }

  async function boot() {
    let loaded = null;
    try {
      loaded = await bridge.loadData();
      data = normalizeData(loaded && loaded.data);
      dataPath = (loaded && loaded.dataPath) || '';
    } catch (err) {
      data = createEmptyData();
      dataPath = '';
    }

    if (DEMO_MODE || (IS_SCREENSHOT && (!loaded || !loaded.data))) {
      data = seedDemo();
      data.meta.onboarded = true;
      demoPreview = true;
    }

    captureOn = !!data.settings.captureEnabled;
    if (IS_DESKTOP && bridge.getVersion) {
      try { appVersion = (await bridge.getVersion()) || appVersion; } catch { /* ignore */ }
    }
    if (IS_DESKTOP && bridge.aiAvailable) {
      try { aiKeyAvailable = !!(await bridge.aiAvailable()); } catch { aiKeyAvailable = false; }
    }
    if (IS_DESKTOP) {
      bridge.setCaptureEnabled(captureOn).catch(function () {});
      bridge.setCloseToTray(!!data.settings.closeToTray).catch(function () {});
    }

    render();
    if (!data.meta.onboarded) openModal({ type: 'onboarding' });
    startReminderTimer();

    bridge.onCapture(function (payload) {
      if (!captureOn || !payload || !payload.text) return;
      ingest({
        text: payload.text,
        atISO: payload.at ? new Date(payload.at).toISOString() : new Date().toISOString(),
        origin: 'clipboard',
        copyEvent: !!payload.copyEvent
      }).catch(function () {});
    });

    bridge.onCaptureState(function (state) {
      if (!state) return;
      captureOn = !!state.enabled;
      if (data) {
        data.settings.captureEnabled = captureOn;
        saveSoon();
      }
      safeRender();
    });

    bridge.onManualCapture(function () {
      openPasteModal();
    });

    bridge.onNapcatStatus(function (status) {
      if (!status) return;
      const previous = napcatStatus.status;
      napcatStatus = Object.assign({}, napcatStatus, status);
      renderNapcatStatusOnly();
      if (status.status === 'online' && previous !== 'online') {
        showToast({
          title: 'NapCat 已连接',
          body: (status.groups || 0) + ' 个群 · ' + (status.friends || 0) + ' 个好友。新来源默认待归类。',
          actions: [{ label: '去来源', action: 'nav-sources' }],
          timeout: 5500
        });
      }
      lastNapcatStatus = status.status;
    });

    bridge.onNapcatSources(function (payload) {
      upsertNapcatSources(payload);
    });

    bridge.onNapcatMessage(function (payload) {
      if (!payload || !payload.text) return;
      ingest({
        text: payload.text,
        atISO: payload.at || new Date().toISOString(),
        origin: 'napcat',
        platform: 'qq',
        externalId: payload.channel && payload.channel.externalId,
        channelName: payload.channel && payload.channel.name,
        kind: payload.channel && payload.channel.kind,
        sender: payload.sender
      }).catch(function () {});
    });

    if (IS_DESKTOP && data.settings.napcat.enabled) {
      applyNapcatConfig(false);
    }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('dblclick', function (event) {
    const cell = event.target.closest && event.target.closest('.day-cell');
    if (!cell || event.target.closest('.event-chip')) return;
    const key = cell.getAttribute('data-date');
    if (!key) return;
    selectedDate = key;
    monthCursor = startOfMonth(parseKey(key));
    openEventModal(null, { date: key });
  });

  boot().catch(function (err) {
    ROOT.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#8d422d">日序启动失败：' + esc(String(err && err.message || err)) + '</div>';
  });
})();
