'use strict';

const { app, BrowserWindow, Menu, Tray, Notification, clipboard, dialog, ipcMain, nativeImage, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');
const Parser = require('./src/parser');
const { SyncEngine } = require('./src/sync-engine');
const { FolderSyncEngine } = require('./src/folder-sync-engine');
const folderSyncCore = require('./src/folder-sync-core');

const APP_NAME = '日序';
const isScreenshot = process.argv.includes('--screenshot');
const iconPath = path.join(__dirname, 'assets', 'icon.png');

if (process.env.RIXU_USER_DATA) {
  try { app.setPath('userData', path.resolve(process.env.RIXU_USER_DATA)); } catch { /* ignore */ }
}

let mainWindow = null;
let tray = null;
let quitting = false;
let closeToTray = true;
let captureEnabled = false;
let captureTimer = null;
let lastClipboard = '';
let lastHash = '';
let trayCaptureItem = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function dataFile() {
  return path.join(app.getPath('userData'), 'data.json');
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function readData() {
  try {
    const file = dataFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
  } catch (err) {
    console.error('read data failed', err);
    return null;
  }
}

function writeData(data) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const body = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

/* ---------------- 账号与同步 ---------------- */

function syncStateFile() {
  return path.join(app.getPath('userData'), 'sync-state.json');
}

function readSyncStateFile() {
  try {
    const file = syncStateFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
  } catch (err) {
    console.error('read sync state failed', err);
    return null;
  }
}

function writeSyncStateFile(state) {
  const file = syncStateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function encryptText(text) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable');
  return safeStorage.encryptString(text).toString('base64');
}

function decryptText(blob) {
  return safeStorage.decryptString(Buffer.from(String(blob), 'base64'));
}

const syncEngine = new SyncEngine({
  readData: readData,
  writeData: writeData,
  dataExists: () => fs.existsSync(dataFile()),
  readState: readSyncStateFile,
  writeState: writeSyncStateFile,
  encrypt: encryptText,
  decrypt: decryptText,
  log: function () {
    const args = Array.prototype.slice.call(arguments);
    console.warn.apply(console, ['[sync]'].concat(args));
  },
  onApplied: function (data, summary) {
    sendToRenderer('sync:applied', { data: data, summary: summary });
  }
});

/* ---------------- 同步文件夹（零账号） ---------------- */

function folderSyncStateFile() {
  return path.join(app.getPath('userData'), 'folder-sync-state.json');
}

function readFolderSyncStateFile() {
  try {
    const file = folderSyncStateFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
  } catch (err) {
    console.error('read folder sync state failed', err);
    return null;
  }
}

function writeFolderSyncStateFile(state) {
  const file = folderSyncStateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const folderSyncEngine = new FolderSyncEngine({
  readData: readData,
  writeData: writeData,
  dataExists: () => fs.existsSync(dataFile()),
  readState: readFolderSyncStateFile,
  writeState: writeFolderSyncStateFile,
  log: function () {
    const args = Array.prototype.slice.call(arguments);
    console.warn.apply(console, ['[folder-sync]'].concat(args));
  },
  onApplied: function (data, summary) {
    sendToRenderer('folder-sync:applied', { data: data, summary: summary });
  }
});

function folderSyncEnabled() {
  const status = folderSyncEngine.status();
  return !!(status.configured && status.enabled);
}

function folderSuggestions() {
  const home = os.homedir();
  const out = [];
  const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
  if (oneDrive && fs.existsSync(oneDrive)) out.push({ label: 'OneDrive', path: path.join(oneDrive, '日序') });
  const nutstore = [
    path.join(home, 'Nutstore', '我的坚果云'),
    path.join(home, 'Nutstore Files', '我的坚果云'),
    path.join(home, '坚果云')
  ].find((candidate) => fs.existsSync(candidate));
  if (nutstore) out.push({ label: '坚果云', path: path.join(nutstore, '日序') });
  const seen = new Set();
  return out.filter((item) => {
    const key = item.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item) => Object.assign({}, item, inspectSyncFolder(item.path)));
}

// 让设置页能直接显示「这个同步盘里有没有日历」，用户不用打开资源管理器。
function inspectSyncFolder(folder) {
  const info = { exists: false, hasCalendar: false, eventCount: 0, calendarId: '', conflict: false };
  try {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return info;
    info.exists = true;
    const files = fs.readdirSync(folder).filter((name) => folderSyncCore.isSnapshotFile(name));
    if (!files.length) return info;
    info.hasCalendar = true;
    const snapshots = [];
    for (const name of files) {
      try {
        snapshots.push({
          name: name,
          data: JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8').replace(/^\ufeff/, ''))
        });
      } catch (err) {
        info.conflict = true;
      }
    }
    const merged = folderSyncCore.mergeSnapshots(snapshots);
    if (!merged.ok || merged.warnings.length) info.conflict = true;
    if (merged.ok) {
      info.calendarId = merged.calendarId || '';
      info.eventCount = merged.rows.filter(function (row) {
        return row.kind === 'event' && !row.deleted;
      }).length;
    }
  } catch (err) {
    info.conflict = true;
  }
  return info;
}

const SYNC_INTERVAL_MS = 60000;
const SYNC_STARTUP_DELAY_MS = 6000;
const SYNC_AFTER_SAVE_MS = 8000;
let syncIntervalTimer = null;
let syncSaveTimer = null;
let syncStartupTimer = null;

function syncAutoEnabled() {
  const status = syncEngine.status();
  return !!(status.configured && status.signedIn) && !folderSyncEnabled();
}

function runSync(reason) {
  if (!syncAutoEnabled() || syncEngine.syncing) return Promise.resolve(null);
  return syncEngine.syncNow(reason).then((result) => {
    if (result && result.ok) {
      sendToRenderer('sync:status', syncEngine.status());
    } else if (result && result.error) {
      sendToRenderer('sync:status', syncEngine.status());
    }
    return result;
  }).catch(() => null);
}

function scheduleSyncAfterSave() {
  if (!syncAutoEnabled()) return;
  if (syncSaveTimer) clearTimeout(syncSaveTimer);
  syncSaveTimer = setTimeout(() => { syncSaveTimer = null; runSync('local-change'); }, SYNC_AFTER_SAVE_MS);
}

function startSyncLoop() {
  if (syncIntervalTimer) clearInterval(syncIntervalTimer);
  syncIntervalTimer = setInterval(() => { runSync('timer'); }, SYNC_INTERVAL_MS);
  if (syncStartupTimer) clearTimeout(syncStartupTimer);
  syncStartupTimer = setTimeout(() => { syncStartupTimer = null; runSync('startup'); }, SYNC_STARTUP_DELAY_MS);
}

function stopSyncLoop() {
  if (syncIntervalTimer) { clearInterval(syncIntervalTimer); syncIntervalTimer = null; }
  if (syncStartupTimer) { clearTimeout(syncStartupTimer); syncStartupTimer = null; }
  if (syncSaveTimer) { clearTimeout(syncSaveTimer); syncSaveTimer = null; }
}

/* ---------------- 同步文件夹定时器 ---------------- */

const FOLDER_SYNC_INTERVAL_MS = 30000;
const FOLDER_SYNC_STARTUP_DELAY_MS = 7000;
const FOLDER_SYNC_AFTER_SAVE_MS = 5000;
let folderSyncIntervalTimer = null;
let folderSyncSaveTimer = null;
let folderSyncStartupTimer = null;

function runFolderSync(reason) {
  if (!folderSyncEnabled() || folderSyncEngine.syncing) return Promise.resolve(null);
  // 登录了 Supabase 就不再自动跑文件夹同步，两种方式二选一。
  if (syncEngine.status().signedIn) return Promise.resolve(null);
  return folderSyncEngine.syncNow(reason).then((result) => {
    sendToRenderer('folder-sync:status', folderSyncEngine.status());
    return result;
  }).catch(() => null);
}

function scheduleFolderSyncAfterSave() {
  if (!folderSyncEnabled()) return;
  if (syncEngine.status().signedIn) return;
  if (folderSyncSaveTimer) clearTimeout(folderSyncSaveTimer);
  folderSyncSaveTimer = setTimeout(() => {
    folderSyncSaveTimer = null;
    runFolderSync('local-change');
  }, FOLDER_SYNC_AFTER_SAVE_MS);
}

function startFolderSyncLoop() {
  if (folderSyncIntervalTimer) clearInterval(folderSyncIntervalTimer);
  folderSyncIntervalTimer = setInterval(() => { runFolderSync('timer'); }, FOLDER_SYNC_INTERVAL_MS);
  if (folderSyncStartupTimer) clearTimeout(folderSyncStartupTimer);
  folderSyncStartupTimer = setTimeout(() => {
    folderSyncStartupTimer = null;
    runFolderSync('startup');
  }, FOLDER_SYNC_STARTUP_DELAY_MS);
}

function stopFolderSyncLoop() {
  if (folderSyncIntervalTimer) { clearInterval(folderSyncIntervalTimer); folderSyncIntervalTimer = null; }
  if (folderSyncStartupTimer) { clearTimeout(folderSyncStartupTimer); folderSyncStartupTimer = null; }
  if (folderSyncSaveTimer) { clearTimeout(folderSyncSaveTimer); folderSyncSaveTimer = null; }
}

function safeReadClipboard() {
  try {
    return clipboard.readText() || '';
  } catch {
    return '';
  }
}

function hashText(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function broadcastCaptureState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('capture:state', { enabled: captureEnabled });
  }
  if (trayCaptureItem) {
    trayCaptureItem.label = captureEnabled ? '暂停采集' : '继续采集';
  }
  updateTrayTooltip();
}

function updateTrayTooltip() {
  if (tray) tray.setToolTip(captureEnabled ? '日序 · 正在采集' : '日序 · 已暂停');
}

// Windows 每次“复制”都会让剪贴板序号 +1，即使复制的是同一段文字。
// 用它区分“用户又复制了一次”和“剪贴板里还留着旧内容”，后者不应该重复入历。
let clipboardSeqFn = null;
let clipboardSeqTried = false;
let lastSeq = 0;

function getClipboardSequence() {
  if (!clipboardSeqTried) {
    clipboardSeqTried = true;
    if (process.platform === 'win32') {
      try {
        const koffi = require('koffi');
        const user32 = koffi.load('user32.dll');
        clipboardSeqFn = user32.func('uint32_t __stdcall GetClipboardSequenceNumber()');
        clipboardSeqFn(); // 预热，避免第一次调用失败
      } catch (err) {
        console.warn('clipboard sequence unavailable, falling back to text diff:', err && err.message);
        clipboardSeqFn = null;
      }
    }
  }
  if (!clipboardSeqFn) return 0;
  try { return clipboardSeqFn(); } catch { return 0; }
}

function startCapture() {
  stopCapture();
  lastClipboard = safeReadClipboard();
  lastSeq = getClipboardSequence();
  captureTimer = setInterval(() => {
    if (!captureEnabled || !mainWindow || mainWindow.isDestroyed()) return;
    const text = safeReadClipboard().trim();
    if (!text) return;
    const seqReady = !!clipboardSeqFn;
    const seq = seqReady ? getClipboardSequence() : 0;
    const copied = seqReady ? seq !== lastSeq : text !== lastClipboard;
    if (seqReady) lastSeq = seq;
    if (!copied) return;
    lastClipboard = text;
    if (text.length > 4000) return;
    const looksRelevant = Parser.looksAICandidate || Parser.looksScheduleLike;
    if (!looksRelevant(text)) return;
    if (!seqReady) {
      const hash = hashText(text);
      if (hash === lastHash) return;
      lastHash = hash;
    }
    mainWindow.webContents.send('capture:text', { text, at: Date.now(), copyEvent: seqReady });
  }, 900);
}

function stopCapture() {
  if (captureTimer) clearInterval(captureTimer);
  captureTimer = null;
}

// 日序没运行时复制的消息，启动后补识别一次。
// 交给渲染层按 hash 去重：识别过的旧内容不会重复入历。
let startupClipboardChecked = false;

function checkStartupClipboard() {
  if (startupClipboardChecked) return false;
  startupClipboardChecked = true;
  if (!captureEnabled || !mainWindow || mainWindow.isDestroyed()) return false;
  const text = safeReadClipboard().trim();
  if (!text || text.length > 4000) return false;
  const looksRelevant = Parser.looksAICandidate || Parser.looksScheduleLike;
  if (!looksRelevant(text)) return false;
  lastClipboard = text;
  lastSeq = getClipboardSequence();
  mainWindow.webContents.send('capture:text', { text, at: Date.now(), copyEvent: false, startup: true });
  return true;
}

function setCapture(enabled) {
  captureEnabled = !!enabled;
  broadcastCaptureState();
  return captureEnabled;
}

function buildTray() {
  if (tray) return;
  let image = nativeImage.createEmpty();
  try {
    if (fs.existsSync(iconPath)) image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch { /* ignore */ }

  tray = new Tray(image);
  tray.setToolTip('日序 · 把聊天里的约定收进日程');
  const menu = Menu.buildFromTemplate([
    { label: '打开日序', click: showWindow },
    { type: 'separator' },
    {
      label: '暂停采集',
      click: () => setCapture(!captureEnabled)
    },
    {
      label: '从剪贴板识别',
      click: () => {
        showWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('capture:manual');
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]);
  trayCaptureItem = menu.items[2];
  tray.setContextMenu(menu);
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
  updateTrayTooltip();
}

const napcat = {
  enabled: false,
  url: 'ws://127.0.0.1:3001',
  token: '',
  configKey: '',
  ws: null,
  status: 'disabled',
  error: '',
  selfId: null,
  nickname: '',
  attempts: 0,
  reconnectTimer: null,
  heartbeatTimer: null,
  pending: new Map(),
  groups: new Map(),
  friends: new Map(),
  seen: new Set(),
  manualStop: true
};

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function napcatPublicStatus() {
  return {
    enabled: napcat.enabled,
    status: napcat.status,
    error: napcat.error,
    url: napcat.url,
    selfId: napcat.selfId,
    nickname: napcat.nickname,
    groups: napcat.groups.size,
    friends: napcat.friends.size,
    attempts: napcat.attempts
  };
}

function setNapcatStatus(status, error) {
  napcat.status = status;
  napcat.error = error || '';
  sendToRenderer('napcat:status', napcatPublicStatus());
}

function clearNapcatReconnect() {
  if (napcat.reconnectTimer) clearTimeout(napcat.reconnectTimer);
  napcat.reconnectTimer = null;
}

function closeNapcatSocket() {
  clearNapcatReconnect();
  if (napcat.heartbeatTimer) clearInterval(napcat.heartbeatTimer);
  napcat.heartbeatTimer = null;
  const ws = napcat.ws;
  napcat.ws = null;
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.close();
    } catch { /* ignore */ }
  }
  for (const item of napcat.pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error('连接已关闭'));
  }
  napcat.pending.clear();
}

function scheduleNapcatReconnect() {
  if (!napcat.enabled || napcat.manualStop) return;
  clearNapcatReconnect();
  napcat.attempts += 1;
  const delay = Math.min(30000, 1000 * Math.pow(1.7, Math.min(napcat.attempts - 1, 8)));
  setNapcatStatus('reconnecting', napcat.error || '连接断开，正在重试');
  napcat.reconnectTimer = setTimeout(() => {
    napcat.reconnectTimer = null;
    connectNapcat();
  }, delay);
}

function napcatRequest(action, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!napcat.ws || napcat.ws.readyState !== WebSocket.OPEN) {
      reject(new Error('NapCat 未连接'));
      return;
    }
    const echo = 'rixu_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const timer = setTimeout(() => {
      napcat.pending.delete(echo);
      reject(new Error(action + ' 请求超时'));
    }, timeoutMs || 10000);
    napcat.pending.set(echo, { resolve, reject, timer });
    try {
      napcat.ws.send(JSON.stringify({ action, params: params || {}, echo }));
    } catch (err) {
      clearTimeout(timer);
      napcat.pending.delete(echo);
      reject(err);
    }
  });
}

function oneBotText(message) {
  if (typeof message === 'string') {
    return message
      .replace(/\[CQ:image[^\]]*\]/g, '[图片]')
      .replace(/\[CQ:[^\]]+\]/g, '')
      .replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&#44;/g, ',')
      .trim();
  }
  if (Array.isArray(message)) {
    return message.map((seg) => {
      if (!seg || typeof seg !== 'object') return '';
      if (seg.type === 'text') return (seg.data && seg.data.text) || '';
      if (seg.type === 'image') return '[图片]';
      if (seg.type === 'at') {
        const qq = seg.data && seg.data.qq;
        return qq === 'all' ? '@所有人 ' : '';
      }
      return '';
    }).join('').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function napcatGroupSource(group) {
  const id = String(group.group_id);
  return {
    externalId: 'qq-group-' + id,
    platform: 'qq',
    kind: 'group',
    name: group.group_name || ('QQ群 ' + id),
    memberCount: group.member_count || 0
  };
}

function napcatFriendSource(friend) {
  const id = String(friend.user_id);
  return {
    externalId: 'qq-friend-' + id,
    platform: 'qq',
    kind: 'friend',
    name: friend.remark || friend.nickname || ('QQ好友 ' + id)
  };
}

async function loadNapcatSources() {
  const tasks = [];
  tasks.push(napcatRequest('get_group_list', {}, 12000).then((res) => {
    const list = Array.isArray(res && res.data) ? res.data : [];
    list.forEach((group) => {
      if (!group || group.group_id == null) return;
      const src = napcatGroupSource(group);
      napcat.groups.set(src.externalId, src);
    });
  }).catch(() => {}));
  tasks.push(napcatRequest('get_friend_list', {}, 12000).then((res) => {
    const list = Array.isArray(res && res.data) ? res.data : [];
    list.forEach((friend) => {
      if (!friend || friend.user_id == null) return;
      const src = napcatFriendSource(friend);
      napcat.friends.set(src.externalId, src);
    });
  }).catch(() => {}));
  await Promise.all(tasks);
  sendToRenderer('napcat:sources', {
    groups: Array.from(napcat.groups.values()),
    friends: Array.from(napcat.friends.values()),
    selfId: napcat.selfId
  });
  sendToRenderer('napcat:status', napcatPublicStatus());
}

function handleNapcatEvent(data) {
  if (!data || typeof data !== 'object') return;
  if (data.post_type === 'meta_event') {
    if (data.meta_event_type === 'lifecycle' || data.meta_event_type === 'heartbeat') {
      if (napcat.status !== 'online') setNapcatStatus('online');
    }
    return;
  }
  if (data.post_type !== 'message') return;
  if (data.message_type !== 'group' && data.message_type !== 'private') return;
  if (data.user_id != null && napcat.selfId != null && String(data.user_id) === String(napcat.selfId)) return;

  const messageId = data.message_id != null ? String(data.message_id) : '';
  if (messageId) {
    if (napcat.seen.has(messageId)) return;
    napcat.seen.add(messageId);
    if (napcat.seen.size > 800) {
      const first = napcat.seen.values().next().value;
      napcat.seen.delete(first);
    }
  }

  const text = oneBotText(data.message) || oneBotText(data.raw_message);
  if (!text || text.length > 4000) return;

  const senderName = (data.sender && (data.sender.card || data.sender.nickname)) || '';
  let channel;
  if (data.message_type === 'group') {
    const groupId = String(data.group_id);
    const cached = napcat.groups.get('qq-group-' + groupId);
    channel = {
      externalId: 'qq-group-' + groupId,
      kind: 'group',
      name: (cached && cached.name) || data.group_name || ('QQ群 ' + groupId),
      memberCount: (cached && cached.memberCount) || 0
    };
  } else {
    const userId = String(data.user_id);
    const cached = napcat.friends.get('qq-friend-' + userId);
    channel = {
      externalId: 'qq-friend-' + userId,
      kind: 'friend',
      name: (cached && cached.name) || senderName || ('QQ好友 ' + userId)
    };
  }

  sendToRenderer('napcat:message', {
    platform: 'qq',
    channel,
    sender: senderName,
    text,
    at: data.time ? new Date(data.time * 1000).toISOString() : new Date().toISOString(),
    messageId
  });
}

function handleNapcatPayload(raw) {
  let data;
  try {
    data = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (data && data.echo && napcat.pending.has(data.echo)) {
    const item = napcat.pending.get(data.echo);
    napcat.pending.delete(data.echo);
    clearTimeout(item.timer);
    if (data.status === 'failed' || (data.retcode != null && data.retcode !== 0)) {
      item.reject(new Error((data.wording || data.message || 'OneBot 调用失败')));
    } else {
      item.resolve(data);
    }
    return;
  }
  handleNapcatEvent(data);
}

function connectNapcat() {
  if (!napcat.enabled) return;
  if (!/^wss?:\/\//i.test(napcat.url)) {
    setNapcatStatus('error', '地址需要以 ws:// 或 wss:// 开头');
    return;
  }
  closeNapcatSocket();
  napcat.manualStop = false;
  setNapcatStatus(napcat.attempts ? 'reconnecting' : 'connecting');

  let ws;
  try {
    ws = new WebSocket(napcat.url, {
      headers: napcat.token ? { Authorization: 'Bearer ' + napcat.token } : {},
      handshakeTimeout: 10000
    });
  } catch (err) {
    setNapcatStatus('error', String(err && err.message || err));
    scheduleNapcatReconnect();
    return;
  }
  napcat.ws = ws;

  ws.on('open', () => {
    if (napcat.ws !== ws) return;
    napcat.attempts = 0;
    napcat.selfId = null;
    napcat.nickname = '';
    setNapcatStatus('online');
    napcat.heartbeatTimer = setInterval(() => {
      if (napcat.ws === ws && ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch { /* ignore */ }
      }
    }, 25000);

    napcatRequest('get_login_info', {}, 8000).then((res) => {
      const info = (res && res.data) || {};
      napcat.selfId = info.user_id != null ? String(info.user_id) : null;
      napcat.nickname = info.nickname || '';
      sendToRenderer('napcat:status', napcatPublicStatus());
      loadNapcatSources();
    }).catch(() => {
      loadNapcatSources();
    });
  });

  ws.on('message', (raw) => handleNapcatPayload(raw));
  ws.on('pong', () => { /* connection alive */ });
  ws.on('error', (err) => {
    if (napcat.ws !== ws) return;
    const msg = String(err && err.message || err);
    napcat.error = /401|403/.test(msg) ? 'Token 不正确，或 NapCat 未允许连接' : msg;
    setNapcatStatus('error', napcat.error);
  });
  ws.on('close', () => {
    if (napcat.ws !== ws) return;
    napcat.ws = null;
    if (napcat.heartbeatTimer) clearInterval(napcat.heartbeatTimer);
    napcat.heartbeatTimer = null;
    if (!napcat.enabled || napcat.manualStop) {
      setNapcatStatus('disabled');
      return;
    }
    scheduleNapcatReconnect();
  });
}

function configureNapcat(config) {
  config = config || {};
  const enabled = !!config.enabled;
  const url = String(config.url || 'ws://127.0.0.1:3001').trim();
  const token = String(config.token || '');
  const key = enabled + '|' + url + '|' + token;
  napcat.enabled = enabled;
  napcat.url = url;
  napcat.token = token;

  if (!enabled) {
    napcat.manualStop = true;
    napcat.error = '';
    closeNapcatSocket();
    setNapcatStatus('disabled');
    return napcatPublicStatus();
  }

  if (key === napcat.configKey && napcat.ws &&
    (napcat.ws.readyState === WebSocket.OPEN || napcat.ws.readyState === WebSocket.CONNECTING)) {
    return napcatPublicStatus();
  }
  napcat.configKey = key;
  napcat.manualStop = false;
  napcat.attempts = 0;
  napcat.error = '';
  connectNapcat();
  return napcatPublicStatus();
}

function createWindow() {  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1060,
    minHeight: 680,
    show: false,
    backgroundColor: '#F2F0EA',
    title: APP_NAME,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  const query = isScreenshot ? { screenshot: '1', demo: '1' } : {};
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'), { query });

  mainWindow.once('ready-to-show', () => {
    if (!isScreenshot) mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (isScreenshot) return;
    if (!quitting && closeToTray) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === 'win32' && Notification.isSupported()) {
        const n = new Notification({
          title: '日序还在后台运行',
          body: '剪贴板采集没有中断。点托盘图标可重新打开。',
          icon: fs.existsSync(iconPath) ? iconPath : undefined,
          silent: true
        });
        n.on('click', showWindow);
        n.show();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isScreenshot) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          const out = path.join(__dirname, 'screenshot.png');
          fs.writeFileSync(out, image.toPNG());
          console.log('screenshot saved:', out);
        } catch (err) {
          console.error('screenshot failed', err);
        } finally {
          quitting = true;
          app.quit();
        }
      }, 2200);
    });
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.rixu.calendar');
  createWindow();
  buildTray();
  startCapture();
  startSyncLoop();
  startFolderSyncLoop();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !closeToTray) app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  stopCapture();
  stopSyncLoop();
  stopFolderSyncLoop();
  napcat.enabled = false;
  napcat.manualStop = true;
  closeNapcatSocket();
});

// Key 的来源优先级：设置里填写 > 环境变量 > 本机 DSH 凭据（仅开发机可能存在）。
function readEnvApiKey() {
  const names = ['RIXU_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'];
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function readDshApiKey() {
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    const text = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8');
    const match = /^\s*DEEPSEEK_API_KEY:\s*["']?([^"'\s#]+)["']?\s*$/mu.exec(text);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function resolveApiKey(config) {
  return String(config && config.apiKey || '').trim() || readEnvApiKey() || readDshApiKey();
}

function hasApiKey() {
  return !!readEnvApiKey() || !!readDshApiKey();
}

function completionUrl(base) {  const url = new URL(base);
  if (/\/chat\/completions\/?$/.test(url.pathname)) return url.toString();
  if (/\/v1\/?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
    return url.toString();
  }
  url.pathname = url.pathname.replace(/\/$/, '') + '/v1/chat/completions';
  return url.toString();
}

function normalizeAISchedule(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const start = String(raw.start || '').trim();
  if (!title || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) return null;
  let end = String(raw.end || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end)) {
    const d = new Date(start);
    d.setMinutes(d.getMinutes() + 60);
    end = Parser.localISO(d);
  }
  return {
    title,
    start,
    end,
    date: start.slice(0, 10),
    time: raw.allDay ? null : start.slice(11, 16),
    allDay: !!raw.allDay,
    location: String(raw.location || '').trim().slice(0, 30),
    note: String(raw.note || '').trim().slice(0, 200),
    confidence: Math.max(0.3, Math.min(0.98, Number(raw.confidence) || 0.78)),
    reasons: ['AI 辅助识别'],
    keyword: 'AI',
    needsDate: false,
    needsTime: !!raw.allDay,
    isQuestion: false,
    viaAI: true,
    sourceText: ''
  };
}

async function callAI(text, now, config) {
  const baseUrl = String(config && config.baseUrl || '').trim();
  const model = String(config && config.model || '').trim();
  const apiKey = resolveApiKey(config);
  if (!baseUrl || !model || !apiKey) return { ok: false, error: '请先在设置里填写 API Key，或设置环境变量 DEEPSEEK_API_KEY' };
  if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: 'API 地址需要以 http(s):// 开头' };

  const date = now instanceof Date ? now : new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  const system = [
    '你是严谨的中文日程抽取器。从聊天消息中找出一个明确的安排，输出 JSON。',
    '当前本地时间：' + Parser.localISO(date) + '，星期' + week + '。',
    'JSON 字段：title(简短中文标题), start(YYYY-MM-DDTHH:mm), end(YYYY-MM-DDTHH:mm), allDay(布尔), location(字符串，可为空), note(主讲人/主办/备注，可为空), confidence(0-0.98)。',
    '规则：相对日期按当前时间换算；没有时间且是截止事项则 allDay=true，start 用当天 09:00；只输出 JSON，不要解释。',
    '如果没有可靠安排，输出 {"none":true}。'
  ].join('\n');

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: String(text).slice(0, 3000) }
    ],
    temperature: 0,
    response_format: { type: 'json_object' }
  };

  const doFetch = async (payload) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      return await fetch(completionUrl(baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let res = await doFetch(body);
    if (!res.ok && res.status === 400) res = await doFetch(Object.assign({}, body, { response_format: undefined }));
    if (!res.ok) {
      let detail = '';
      try {
        const err = await res.json();
        detail = (err.error && (err.error.message || err.error.type)) || '';
      } catch { /* ignore */ }
      return { ok: false, error: 'API 返回 ' + res.status + (detail ? '：' + String(detail).slice(0, 120) : '') };
    }
    const json = await res.json();
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!content) return { ok: false, error: 'API 没有返回内容' };
    const cleaned = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.none) return { ok: true, schedule: null };
    const schedule = normalizeAISchedule(parsed, date);
    if (!schedule) return { ok: false, error: 'AI 返回的日程格式不完整' };
    schedule.sourceText = String(text).slice(0, 4000);
    return { ok: true, schedule };
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? '请求超时' : String(err && err.message || err);
    return { ok: false, error: msg.slice(0, 160) };
  }
}

ipcMain.handle('ai:extract', async (_event, payload) => {
  return callAI(payload && payload.text, new Date(), payload && payload.config);
});

ipcMain.handle('ai:available', () => hasApiKey());

ipcMain.handle('napcat:configure', (_event, config) => configureNapcat(config));
ipcMain.handle('napcat:status', () => napcatPublicStatus());
ipcMain.handle('napcat:reconnect', () => {
  napcat.attempts = 0;
  napcat.error = '';
  if (napcat.enabled) connectNapcat();
  return napcatPublicStatus();
});
ipcMain.handle('napcat:disconnect', () => configureNapcat(Object.assign({}, {
  enabled: false,
  url: napcat.url,
  token: napcat.token
})));

ipcMain.handle('data:load', () => ({ data: readData(), dataPath: dataFile() }));
ipcMain.handle('data:save', (_event, data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('invalid data');
  }
  const ok = writeData(data);
  scheduleSyncAfterSave();
  scheduleFolderSyncAfterSave();
  return ok;
});

ipcMain.handle('sync:status', () => syncEngine.status());

function supabaseBlockedByFolder() {
  if (!folderSyncEnabled()) return null;
  return { ok: false, error: '同步文件夹已启用。两种方式二选一：先停用同步文件夹，再使用 Supabase。' };
}

ipcMain.handle('sync:configure', async (_event, payload) => {
  const result = await syncEngine.configure(payload);
  sendToRenderer('sync:status', syncEngine.status());
  return result;
});

ipcMain.handle('sync:signin', async (_event, payload) => {
  const blocked = supabaseBlockedByFolder();
  if (blocked) return blocked;
  const result = await syncEngine.signIn(payload);
  sendToRenderer('sync:status', syncEngine.status());
  return result;
});

ipcMain.handle('sync:signup', async (_event, payload) => {
  const blocked = supabaseBlockedByFolder();
  if (blocked) return blocked;
  const result = await syncEngine.signUp(payload);
  sendToRenderer('sync:status', syncEngine.status());
  return result;
});

ipcMain.handle('sync:signout', () => {
  const result = syncEngine.signOut();
  sendToRenderer('sync:status', result.status);
  return result;
});

ipcMain.handle('sync:now', async () => {
  const blocked = supabaseBlockedByFolder();
  if (blocked) return blocked;
  const result = await syncEngine.syncNow('manual');
  sendToRenderer('sync:status', syncEngine.status());
  return result;
});

/* ---------------- 同步文件夹 IPC ---------------- */

ipcMain.handle('folder-sync:status', () => folderSyncEngine.status());

ipcMain.handle('folder-sync:detect', () => folderSuggestions());

ipcMain.handle('folder-sync:pick', async () => {
  const suggestions = folderSuggestions();
  const defaultPath = suggestions.length ? suggestions[0].path : app.getPath('documents');
  const options = {
    title: '选择同步文件夹（OneDrive / 坚果云 / 任意同步盘）',
    defaultPath: defaultPath,
    properties: ['openDirectory', 'createDirectory']
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, folder: result.filePaths[0] };
});

ipcMain.handle('folder-sync:configure', async (_event, payload) => {
  if (syncEngine.status().signedIn) {
    return { ok: false, error: '当前已登录 Supabase。先退出 Supabase，再启用同步文件夹（两种方式二选一）。' };
  }
  const folder = typeof payload === 'string' ? payload : (payload && payload.folder);
  const join = !!(payload && typeof payload === 'object' && payload.join);
  const result = await folderSyncEngine.configure(folder, { join: join });
  sendToRenderer('folder-sync:status', folderSyncEngine.status());
  return result;
});

ipcMain.handle('folder-sync:disable', () => {
  const result = folderSyncEngine.disable();
  sendToRenderer('folder-sync:status', result.status);
  return result;
});

ipcMain.handle('folder-sync:now', async () => {
  if (syncEngine.status().signedIn) {
    return { ok: false, error: 'Supabase 已登录，文件夹同步已暂停。' };
  }
  const result = await folderSyncEngine.syncNow('manual');
  sendToRenderer('folder-sync:status', folderSyncEngine.status());
  return result;
});

ipcMain.handle('folder-sync:open', async () => {
  const status = folderSyncEngine.status();
  if (!status.folder) return '还没有选择同步文件夹。';
  return shell.openPath(status.folder);
});

ipcMain.handle('capture:set-enabled', (_event, enabled) => setCapture(enabled));

ipcMain.handle('capture:ready', () => checkStartupClipboard());

ipcMain.handle('capture:read', () => {
  const text = safeReadClipboard();
  lastClipboard = text;
  return text;
});

ipcMain.handle('capture:take', () => {
  const text = safeReadClipboard().trim();
  if (!text) return { ok: false, reason: 'empty' };
  lastClipboard = text;
  lastHash = hashText(text);
  return { ok: true, text, at: Date.now() };
});

ipcMain.handle('notify', (_event, payload) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({
    title: (payload && payload.title) || '日序',
    body: (payload && payload.body) || '',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    silent: false
  });
  n.on('click', showWindow);
  n.show();
  return true;
});

ipcMain.handle('app:set-close-to-tray', (_event, value) => {
  closeToTray = !!value;
  return closeToTray;
});

ipcMain.handle('app:set-login-item', (_event, enabled) => {
  try {
    const opts = { openAtLogin: !!enabled };
    if (!app.isPackaged) {
      opts.path = process.execPath;
      opts.args = [app.getAppPath()];
    }
    app.setLoginItemSettings(opts);
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
});

ipcMain.handle('app:get-login-item', () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
});

ipcMain.handle('app:open-data-folder', () => {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return shell.openPath(path.dirname(file));
});

ipcMain.handle('app:export', async (_event, payload) => {
  const now = new Date();
  const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出日序数据',
    defaultPath: path.join(app.getPath('documents'), '日序备份-' + stamp + '.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  const data = payload || readData();
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, path: result.filePath };
});

ipcMain.handle('app:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入日序数据',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  const text = fs.readFileSync(result.filePaths[0], 'utf8');
  return { ok: true, data: JSON.parse(text.replace(/^\ufeff/, '')), path: result.filePaths[0] };
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('app:show', () => showWindow());
