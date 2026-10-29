/*
 * 日序 · Supabase 同步客户端
 *
 * 只用 Supabase 的两个公开能力：
 * - Auth（邮箱 + 密码，GoTrue）
 * - REST（PostgREST，表 rixu_items，RLS 按 auth.uid() 隔离）
 *
 * 不依赖 Electron，主进程和测试都可以直接 require。
 */
'use strict';

const TIMEOUT_MS = 15000;
const PAGE_SIZE = 500;
const PUSH_BATCH = 200;

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function isHttpUrl(url) {
  return /^https?:\/\/[^\s]+$/i.test(String(url || ''));
}

function authHeaders(anonKey) {
  return {
    apikey: anonKey,
    'Content-Type': 'application/json'
  };
}

function errorMessage(status, body) {
  const text = String(body || '');
  if (/invalid login credentials/i.test(text)) return '邮箱或密码不对。';
  if (/email not confirmed/i.test(text)) return '邮箱还没有验证，先去邮箱点确认链接。';
  if (/user already registered/i.test(text)) return '这个邮箱已经注册过了，直接登录即可。';
  if (/password should be at least/i.test(text)) return '密码太短，至少 6 位。';
  if (/rate limit|too many requests/i.test(text)) return '尝试太频繁，等一会儿再试。';
  if (/row-level security/i.test(text)) return '数据库权限被拒绝，检查 rixu_items 的 RLS 策略是否已执行。';
  if (/relation .*rixu_items.* does not exist/i.test(text)) return '数据库里还没有 rixu_items 表，先执行 supabase/schema.sql。';
  if (status === 401 || status === 403) return '没有权限（Key 或登录态可能不对）。';
  if (status === 404) return '接口不存在，检查 Supabase 地址是否填对。';
  if (status >= 500) return '服务器错误（' + status + '），稍后再试。';
  return '请求失败（' + status + '）。';
}

async function request(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    return { ok: res.ok, status: res.status, body: body, text: text };
  } finally {
    clearTimeout(timer);
  }
}

function networkError(err) {
  const name = err && err.name;
  if (name === 'AbortError') return '连接超时，检查网络。';
  return '连不上 Supabase，检查网络和地址。';
}

/* ---------------- 认证 ---------------- */

function sessionFromAuth(body) {
  if (!body || !body.access_token) return null;
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    userId: (body.user && body.user.id) || '',
    email: (body.user && body.user.email) || ''
  };
}

async function signIn(opts) {
  const url = normalizeUrl(opts.url);
  if (!isHttpUrl(url)) return { ok: false, error: 'Supabase 地址不对。' };
  if (!opts.anonKey) return { ok: false, error: '还没填 anon key。' };
  try {
    const res = await request(url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: authHeaders(opts.anonKey),
      body: JSON.stringify({ email: opts.email, password: opts.password })
    });
    if (!res.ok) return { ok: false, error: errorMessage(res.status, res.text) };
    const session = sessionFromAuth(res.body);
    if (!session) return { ok: false, error: '登录返回异常，检查 Supabase 配置。' };
    return { ok: true, session: session };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}

async function signUp(opts) {
  const url = normalizeUrl(opts.url);
  if (!isHttpUrl(url)) return { ok: false, error: 'Supabase 地址不对。' };
  if (!opts.anonKey) return { ok: false, error: '还没填 anon key。' };
  try {
    const res = await request(url + '/auth/v1/signup', {
      method: 'POST',
      headers: authHeaders(opts.anonKey),
      body: JSON.stringify({ email: opts.email, password: opts.password })
    });
    if (!res.ok) return { ok: false, error: errorMessage(res.status, res.text) };
    const session = sessionFromAuth(res.body);
    if (!session) {
      return { ok: false, needConfirm: true, error: '注册成功，去邮箱点确认链接，然后回来登录。' };
    }
    return { ok: true, session: session };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}

async function refreshSession(opts) {
  const url = normalizeUrl(opts.url);
  try {
    const res = await request(url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: authHeaders(opts.anonKey),
      body: JSON.stringify({ refresh_token: opts.refresh })
    });
    if (!res.ok) return { ok: false, error: errorMessage(res.status, res.text) };
    const session = sessionFromAuth(res.body);
    if (!session) return { ok: false, error: '登录已失效，请重新登录。' };
    return { ok: true, session: session };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}

async function checkConfig(opts) {
  const url = normalizeUrl(opts.url);
  if (!isHttpUrl(url)) return { ok: false, error: '地址要以 https:// 开头。' };
  if (!opts.anonKey) return { ok: false, error: '还没填 anon key。' };
  try {
    const res = await request(url + '/auth/v1/settings', {
      method: 'GET',
      headers: { apikey: opts.anonKey }
    });
    if (!res.ok) return { ok: false, error: errorMessage(res.status, res.text) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}

/* ---------------- 数据 ---------------- */

function restHeaders(anonKey, access) {
  return {
    apikey: anonKey,
    Authorization: 'Bearer ' + access,
    'Content-Type': 'application/json'
  };
}

async function pull(opts) {
  const url = normalizeUrl(opts.url);
  const query = new URLSearchParams();
  query.set('select', 'kind,id,payload,updated_at,deleted');
  query.set('order', 'updated_at.asc');
  query.set('limit', String(PAGE_SIZE));
  if (opts.since) query.set('updated_at', 'gt.' + opts.since);
  try {
    const res = await request(url + '/rest/v1/rixu_items?' + query.toString(), {
      method: 'GET',
      headers: restHeaders(opts.anonKey, opts.access)
    });
    if (!res.ok) return { ok: false, error: errorMessage(res.status, res.text) };
    return { ok: true, rows: Array.isArray(res.body) ? res.body : [] };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}

async function push(opts) {
  const url = normalizeUrl(opts.url);
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  if (!rows.length) return { ok: true, pushed: 0 };
  let pushed = 0;
  for (let i = 0; i < rows.length; i += PUSH_BATCH) {
    const batch = rows.slice(i, i + PUSH_BATCH).map(function (row) {
      return {
        user_id: opts.userId,
        kind: row.kind,
        id: row.id,
        payload: row.payload,
        updated_at: row.updated_at,
        deleted: !!row.deleted
      };
    });
    try {
      const res = await request(url + '/rest/v1/rixu_items?on_conflict=user_id,kind,id', {
        method: 'POST',
        headers: Object.assign(restHeaders(opts.anonKey, opts.access), {
          Prefer: 'resolution=merge-duplicates,return=minimal'
        }),
        body: JSON.stringify(batch)
      });
      if (!res.ok) return { ok: false, error: errorMessage(res.status, res.text) };
      pushed += batch.length;
    } catch (err) {
      return { ok: false, error: networkError(err) };
    }
  }
  return { ok: true, pushed: pushed };
}

module.exports = {
  normalizeUrl: normalizeUrl,
  isHttpUrl: isHttpUrl,
  errorMessage: errorMessage,
  signIn: signIn,
  signUp: signUp,
  refreshSession: refreshSession,
  checkConfig: checkConfig,
  pull: pull,
  push: push
};
