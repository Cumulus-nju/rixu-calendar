'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const { pathToFileURL } = require('url');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const URL = pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href + '?demo=1';
const USER_DIR = path.join(__dirname, '_edge_profile');
const SHOT_DIR = path.join(__dirname, '..');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(USER_DIR, { recursive: true });
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + USER_DIR, '--window-size=1400,900', '--hide-scrollbars', URL
  ], { stdio: 'ignore', windowsHide: true });

  let target = null;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      target = list.find((t) => t.type === 'page' && t.url.indexOf('index.html') >= 0);
      if (target) break;
    } catch {}
    await sleep(200);
  }
  if (!target) throw new Error('no page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  const errors = [];
  const logs = [];
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') logs.push(e.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      logs.push(msg.params.args.map((a) => a.value || a.description).join(' '));
    }
  });

  function send(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' ' + JSON.stringify(res.exceptionDetails.exception || {}));
    return res.result.value;
  }
  async function shot(name) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(res.data, 'base64'));
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await sleep(1200);

  const initial = await evaluate(`(() => ({
    title: document.title,
    cells: document.querySelectorAll('.day-cell').length,
    chips: document.querySelectorAll('.event-chip').length,
    pending: document.querySelectorAll('.inbox-card').length,
    nav: document.querySelectorAll('.nav-item').length,
    text: document.body.innerText.slice(0, 120)
  }))()`);
  console.log('INITIAL', initial);

  await evaluate(`document.querySelector('[data-action="nav"][data-view="inbox"]').click()`);
  await sleep(350);
  const inbox = await evaluate(`(() => ({cards: document.querySelectorAll('.inbox-card').length, h1: document.querySelector('.page-head h1') && document.querySelector('.page-head h1').textContent}))()`);
  console.log('INBOX', inbox);
  await shot('preview-inbox.png');

  await evaluate(`document.querySelector('[data-action="nav"][data-view="calendar"]').click()`);
  await sleep(250);
  await evaluate(`document.querySelector('[data-action="add-event"]').click()`);
  await sleep(250);
  const modal = await evaluate(`(() => ({open: !!document.querySelector('.modal'), title: document.querySelector('.modal h2') && document.querySelector('.modal h2').textContent}))()`);
  console.log('MODAL', modal);
  await shot('preview-modal.png');

  await evaluate(`(() => {
    const f = document.querySelector('form[data-form="event"]');
    f.querySelector('[name="title"]').value = '测试日程';
    f.querySelector('[name="date"]').value = '2026-10-29';
    f.querySelector('[name="time"]').value = '14:00';
    f.querySelector('[name="endTime"]').value = '15:00';
    f.querySelector('[name="location"]').value = '测试教室';
    f.requestSubmit();
  })()`);
  await sleep(500);
  const afterAdd = await evaluate(`(() => ({
    modal: !!document.querySelector('.modal'),
    toast: document.querySelector('.toast .toast-body strong') && document.querySelector('.toast .toast-body strong').textContent,
    hasEvent: Array.from(document.querySelectorAll('.event-chip')).some((x) => x.textContent.indexOf('测试日程') >= 0),
    chips: document.querySelectorAll('.event-chip').length
  }))()`);
  console.log('AFTER_ADD', afterAdd);

  await evaluate(`document.querySelector('[data-action="open-paste"]').click()`);
  await sleep(350);
  await evaluate(`(() => {
    const f = document.querySelector('form[data-form="paste"]');
    f.querySelector('[name="text"]').value = '张老师：后天上午10点在三楼会议室开会，请准时参加。';
    f.querySelector('[name="source"]').value = '测试家长群';
    f.querySelector('[name="platform"]').value = 'wechat';
    f.requestSubmit();
  })()`);
  await sleep(700);
  const afterPaste = await evaluate(`(() => ({
    modal: !!document.querySelector('.modal'),
    toast: document.querySelector('.toast') && document.querySelector('.toast').innerText,
    page: document.querySelector('.page-head h1') && document.querySelector('.page-head h1').textContent,
    chips: Array.from(document.querySelectorAll('.event-chip')).map((x) => x.textContent),
    body: document.body.innerText.slice(0, 160)
  }))()`);
  console.log('AFTER_PASTE', afterPaste);

  await evaluate(`document.querySelector('[data-action="nav"][data-view="sources"]').click()`);
  await sleep(350);
  const sources = await evaluate(`(() => ({rows: document.querySelectorAll('.source-row').length, summary: document.querySelector('.source-summary') && document.querySelector('.source-summary').innerText}))()`);
  console.log('SOURCES', sources);
  await shot('preview-sources.png');

  await evaluate(`document.querySelector('[data-action="nav"][data-view="settings"]').click()`);
  await sleep(300);
  const settings = await evaluate(`(() => ({sections: document.querySelectorAll('.settings-section').length, text: document.body.innerText.slice(0, 200)}))()`);
  console.log('SETTINGS', settings);
  await shot('preview-settings.png');

  console.log('JS_EXCEPTIONS', errors);
  console.log('CONSOLE_ERRORS', logs);

  ws.close();
  child.kill();
  await sleep(300);
}

main().catch((err) => { console.error('FAIL', err); process.exitCode = 1; });
