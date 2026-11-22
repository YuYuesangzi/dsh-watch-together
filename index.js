/**
 * watch-together — 陪看 B站视频
 *
 * 它做什么：
 *   · 从本机调试 Edge（--remote-debugging-port=9222）读真实播放进度
 *   · 把"正在看什么、放到哪、暂停没"注入到每一轮的 system prompt
 *   · 往视频页面上贴一条半透明小字（点到穿，5 秒淡出）
 *   · 给 Agent 五个工具：watch_start / watch_status / watch_sync / watch_here / watch_stop
 *
 * 边界：
 *   · 只读本机 127.0.0.1:9222，不读 cookie、不碰其它标签页内容
 *   · 只支持 B站网页播放器（video.currentTime）
 *   · 不会替 Agent 主动发言（那需要往会话里塞提示，属于另一档开关）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 不依赖打包好的工具助手：defineTool 只是给类型用的恒等包装
const defineTool = (def) => def;
import { createOverlay } from './overlay.js';

export const name = 'watch-together';
export const inject = ['tools', 'systemPrompt']; // AUTO_OVERLAY

const DATA_DIR = path.join(os.homedir(), '.dsh', 'watch');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CDP_PORT = Number(process.env.DSH_WATCH_PORT || 9222);
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function autoLog(msg) { try { fs.appendFileSync(path.join(DATA_DIR, 'auto.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch { /* ignore */ } }

function log(...args) {
  // 只往宿主日志写，不打扰对话
  try {
    // eslint-disable-next-line no-console
    console.log('[watch-together]', ...args);
  } catch {
    /* ignore */
  }
}

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  ensureDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
  } catch (e) {
    log('save state failed', e?.message);
  }
}

function clearState() {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    /* ignore */
  }
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function elapsedOf(state) {
  if (!state) return 0;
  if (state.paused && Number.isFinite(Number(state.pausedAt))) return Math.max(0, Math.floor((Number(state.pausedAt) - Number(state.startedAt)) / 1000));
  return Math.max(0, Math.floor((Date.now() - Number(state.startedAt || Date.now())) / 1000));
}

function bvidOf(text) {
  const m = String(text || '').match(/BV[0-9A-Za-z]{8,12}/);
  return m ? m[0] : '';
}

function epOf(text) {
  const m = String(text || '').match(/ep(\d{3,})/i);
  return m ? m[1] : '';
}

async function cdpTargets() {
  try {
    const r = await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function evaluate(wsUrl, expression, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const WS = globalThis.WebSocket;
    if (typeof WS !== 'function') return resolve(null);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    let ws;
    try {
      ws = new WS(wsUrl);
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => finish(null), timeoutMs);
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== 1) return;
        clearTimeout(timer);
        finish(msg?.result?.result?.value ?? null);
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
  });
}

const VIDEO_EXPR = `(function(){
  var v = document.querySelector('video');
  if (!v) return '';
  var eps = [].slice.call(document.querySelectorAll('a[href*="/bangumi/play/ep"]'));
  var act = eps.find(function(a){ return /active|cur|current/i.test(a.className || '') || a.getAttribute('aria-current'); });
  var ep = act ? ((act.getAttribute('href') || '').match(/ep(\\d{3,})/) || [])[1] : '';
  var tt = document.querySelector('.bpx-player-top-title');
  var epTitle = tt ? String(tt.textContent || '').trim().slice(0, 40) : '';
  return JSON.stringify({
    t: Math.floor(v.currentTime || 0),
    d: Math.floor(v.duration || 0),
    paused: !!v.paused,
    url: location.href,
    ep: ep || '',
    epTitle: epTitle
  });
})()`;

async function bestVideo() {
  const pages = (await cdpTargets()).filter((x) => x.type === 'page' && /bilibili\.com/i.test(String(x.url || '')));
  const found = [];
  for (const page of pages) {
    const raw = await evaluate(page.webSocketDebuggerUrl, VIDEO_EXPR);
    if (!raw) continue;
    let info = null;
    try {
      info = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!info || !Number.isFinite(Number(info.t))) continue;
    let score = 0;
    if (!info.paused) score += 1000;
    score += Math.min(300, Math.floor(Number(info.d || 0) / 10));
    found.push({ page, info, score });
  }
  found.sort((a, b) => b.score - a.score);
  return found[0] || null;
}

/** 把 B站链接/BV/ep 解析成片名与时长（只用公开接口） */
async function resolveMeta(input) {
  const bvid = bvidOf(input);
  const ep = epOf(input);
  const headers = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' };
  try {
    if (bvid) {
      const v = await (await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers, signal: AbortSignal.timeout(8000) })).json();
      if (v.code === 0) return { bvid, title: String(v.data.title || bvid), duration: Number(v.data.duration || 0), cid: Number(v.data.cid || 0), ep: '', epTitle: '' };
    }
    if (ep) {
      const j = await (await fetch(`https://api.bilibili.com/pgc/view/web/season?ep_id=${ep}`, { headers, signal: AbortSignal.timeout(8000) })).json();
      const list = j?.result?.episodes || [];
      if (list.length) {
        const hit = list.find((x) => String(x.ep_id) === String(ep) || String(x.id) === String(ep)) || list[0];
        const series = String(j?.result?.season_title || '');
        return {
          bvid: String(hit.bvid || ''),
          title: `${series ? series + ' ' : ''}${hit.title ? '第' + hit.title + '话 ' : ''}${hit.long_title || ''}`.trim(),
          duration: Math.round(Number(hit.duration || 0) / 1000),
          cid: Number(hit.cid || 0),
          ep: String(ep),
          epTitle: String(hit.long_title || ''),
        };
      }
    }
  } catch (e) {
    log('resolve meta failed', e?.message);
  }
  return null;
}

/** 没字幕时用弹幕：取当前时刻附近一条（公开接口，不需要登录） */
async function danmakuLine(cid, sec) {
  if (!cid) return '';
  try {
    const r = await fetch(`https://comment.bilibili.com/${cid}.xml`, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }, signal: AbortSignal.timeout(8000) });
    const xml = await r.text();
    const rows = [];
    const re = /<d p="([\d.]+)[^"]*">([^<]*)<\/d>/g;
    let m;
    while ((m = re.exec(xml))) {
      const t = Number(m[1]) || 0;
      // 弹幕 XML 不是按时间排序的，不能提前 break；窗口放宽到 90 秒
      if (t > sec - 90 && t <= sec) rows.push({ t, text: String(m[2] || '').trim() });
    }
    if (!rows.length) return '';
    rows.sort((a, b) => a.t - b.t);
    return rows[rows.length - 1].text.slice(0, 50);
  } catch {
    return '';
  }
}

/** 画面上的半透明小字 */
export function apply(ctx) {
  const showOverlay = createOverlay({
    bestPage: async () => { const best = await bestVideo(); return best ? best.page : null; },
    evaluate,
  });
  log('loaded');

  const textOutput = (schemaProps) => ({
    schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, ...schemaProps }, required: ['text'] },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  });

  ctx.tools.register(
    defineTool({
      name: 'watch_start',
      description:
        '开始和用户一起看一部 B站 视频/番剧。不传 video 时用「陪看模式Edge」当前打开的页面；传 B站链接、BV 号或番剧 ep 链接也可以。开始后会读真实播放位置并在此后的对话里带上"看到哪"。',
      parameters: {
        video: { type: 'string', description: 'B站链接、BV 号或番剧 ep 链接。省略时用调试 Edge 当前页面。' },
      },
      output: textOutput(),
      async execute(args) {
        const input = String(args?.video || '').trim();
        let src = input;
        if (!src) {
          const best = await bestVideo();
          if (!best) return { text: '没找到正在播放的 B站页面（「陪看模式Edge」开着并在放视频吗？）' };
          src = best.info.url || '';
          if (best.info.ep) src = `https://www.bilibili.com/bangumi/play/ep${best.info.ep}`;
        }
        const meta = await resolveMeta(src);
        if (!meta) return { text: '解析不了这个链接（支持 B站视频/番剧链接或 BV 号）。' };
        const state = {
          bvid: meta.bvid,
          title: meta.title,
          duration: meta.duration,
          cid: meta.cid,
          ep: meta.ep,
          epTitle: meta.epTitle,
          startedAt: Date.now(),
          paused: false,
          pausedAt: 0,
          createdAt: Date.now(),
        };
        // 立刻对一次真实进度
        try {
          const best = await bestVideo();
          if (best && Number.isFinite(Number(best.info.t))) {
            state.startedAt = Date.now() - Number(best.info.t) * 1000;
            state.paused = !!best.info.paused;
            state.pausedAt = state.paused ? Number(state.startedAt) + Number(best.info.t) * 1000 : 0;
            if (!state.title) state.title = String(best.page.title || '');
          }
        } catch {
          /* ignore */
        }
        saveState(state);
        const el = elapsedOf(state);
        return { text: `开始一起看《${state.title}》（${Math.round(Number(state.duration) / 60)} 分钟）。已看到 ${fmt(el)}，是接着看、不是从头。` };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'watch_status',
      description: '看当前陪看的片名、已看到的时间、总时长、是否暂停。',
      parameters: {},
      output: textOutput(),
      async execute() {
        const state = loadState();
        if (!state) return { text: '现在没有在陪看。' };
        const el = elapsedOf(state);
        return { text: `《${state.title}》看到 ${fmt(el)} / ${fmt(state.duration)}${state.paused ? '（暂停中）' : ''}` };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'watch_sync',
      description: '校准陪看进度：用户说"我看到 15 分 20 秒/我拖回去了"时用；也可不传参数，直接对齐到调试 Edge 的真实进度。',
      parameters: {
        at: { type: 'string', description: '播放进度，如 15:20 或 15分20秒；省略则读真实进度。' },
      },
      output: textOutput(),
      async execute(args) {
        const state = loadState();
        if (!state) return { text: '现在没有在陪看。' };
        const raw = String(args?.at || '').trim();
        let sec = NaN;
        if (raw) {
          let m = raw.match(/^(\d{1,2}):(\d{2})$/);
          if (m) sec = Number(m[1]) * 60 + Number(m[2]);
          else if ((m = raw.match(/(\d{1,2})\s*分\s*(\d{1,2})?/))) sec = Number(m[1]) * 60 + Number(m[2] || 0);
          else if ((m = raw.match(/^(\d{1,5})$/))) sec = Number(m[1]);
        } else {
          const best = await bestVideo();
          if (best) sec = Number(best.info.t);
        }
        if (!Number.isFinite(sec)) return { text: `没看懂这个时间：${raw || '（空）'}` };
        state.startedAt = Date.now() - sec * 1000;
        state.paused = false;
        saveState(state);
        return { text: `同步到 ${fmt(sec)} 了。` };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'watch_here',
      description: '看当前时刻的画面参考：优先台词（有字幕时），没有就取附近弹幕。',
      parameters: {},
      output: textOutput(),
      async execute() {
        const state = loadState();
        if (!state) return { text: '现在没有在陪看。' };
        const el = elapsedOf(state);
        const line = await danmakuLine(state.cid, el);
        return { text: line ? `看到 ${fmt(el)}，弹幕在刷「${line}」` : `看到 ${fmt(el)}，这一刻没有弹幕，大概是画面/配乐段落。` };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'watch_stop',
      description: '结束这次陪看。',
      parameters: {},
      output: textOutput(),
      async execute() {
        const state = loadState();
        clearState();
        if (!state) return { text: '本来也没在陪看。' };
        return { text: `不看了。《${state.title}》一起看了 ${fmt(elapsedOf(state))}。` };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'watch_say',
      description:
        '陪看时把一句话贴到视频画面上（半透明小字，几秒淡出，不挡点击）。适合短评、吐槽、提醒；一次一句，10~30 字。看不到画面或没在陪看时不要用。',
      parameters: {
        text: { type: 'string', description: '要贴在画面上的一句话，10~30 字，可带〔动作〕。' },
        seconds: { type: 'number', description: '停留几秒，默认 5。' },
      },
      output: textOutput(),
      async execute(args) {
        const txt = String(args?.text || '').trim();
        if (!txt) return { text: '要贴什么？' };
        const ok = await showOverlay(txt, Number(args?.seconds) || 5);
        return { text: ok ? '已贴到画面上。' : '没找到可贴的 B站 页面（陪看模式Edge 里在放视频吗？）。' };
      },
    }),
  );

  // WATCH_SAY：陪看时优先贴一句到画面上，再在聊天里说完整的

  // 服务引用（llm / 默认模型）：用 inject 拿，而不是 ctx.get
  let svcRefs = { llm: null, model: null }; // svcRefs
  ctx.inject(['llm', 'agentDefaultModel'], (c) => { svcRefs.llm = c.llm; svcRefs.model = c.agentDefaultModel; });

  // ★ AUTO_OVERLAY：每 30 秒一句，贴到画面上（不进聊天、不花主对话上下文）
  const AUTO_MS = Number(process.env.DSH_WATCH_AUTO_MS || 30000);
  let autoTimer = null;
  let lastLine = '';
  let autoBusy = false;
  const autoOn = () => {
    try {
      const s = loadState();
      return !!(s && s.auto !== false);
    } catch { return false; }
  };
  const genLine = async (context) => {
    const prompt = '你在陪用户看 B站视频《' + context.title + '》，现在放到 ' + context.clock + '。' +
      (context.paused ? '用户暂停了。' : '') +
      '刚看到/听到：' + (context.line || '（这一段没有弹幕）') + '。' +
      '用一句很短的中文吐槽（10~20 字，可带〔动作〕），像随口说的，不要解释剧情，不要报时间。只输出这一句。';
    const out = [];
    try {
      let provider = '';
      let model = '';
      try {
        const sel = svcRefs.model?.currentSelection?.();
        provider = String(sel?.provider || '');
        model = String(sel?.model || '');
      } catch { /* ignore */ }
      if (!provider || !model) { autoLog('no model selection'); return ''; }
      autoLog('gen with ' + provider + '/' + model);
      if (!svcRefs.llm) { autoLog('no llm service'); return ''; }
      const stream = svcRefs.llm.stream({
        provider,
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        temperature: 1.0,
        maxTokens: 400,
        system: '你只需要输出一句很短的中文短评，不要解释，不要思考过程，不要引号。',
        // purpose 用默认即可，避免枚举不匹配
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') out.push(chunk.text);
        if (out.join('').length > 120) break;
      }
    } catch (e) {
      autoLog('gen failed: ' + (e && e.message));
      return '';
    }
    return out.join('').replace(/\s+/g, ' ').trim().replace(/^["「『]|["」』]$/g, '');
  };

  if (process.env.DSH_WATCH_AUTO !== '0') {
    autoTimer = setInterval(async () => {
      try { autoLog('tick'); } catch { /* ignore */ }
      if (autoBusy) return;
      const state = loadState();
      if (!state || !autoOn()) return;
      const best = await bestVideo();
      if (!best) { autoLog('no best video'); return; }
      const clientNow = Number(best.info.t);
      const line = await danmakuLine(state.cid, elapsedOf(state));
      if (!line) { autoLog('no danmaku'); return; }
      if (line === lastLine) return;
      lastLine = line;
      autoBusy = true;
      try {
        autoLog('tick line=' + String(line).slice(0,20));
        const text = await genLine({ title: state.title, clock: fmt(elapsedOf(state)), paused: !!state.paused, line });
        if (!text) { autoLog('gen empty, fallback to danmaku'); }
        if (text || line) {
          const shown = text || ('〔看片〕' + String(line).slice(0, 30));
          await showOverlay(shown, 6);
          autoLog('shown: ' + shown.slice(0, 40));
        }
      } finally { autoBusy = false; }
    }, AUTO_MS);
    try { autoTimer.unref?.(); } catch { /* ignore */ }
  }

  // ★ WEB_ROUTES：给设置页按钮用（同源 fetch）
  ctx.inject(['webServer'], (webCtx) => {
    const sendJson = (res, code, obj) => {
      try {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
      } catch { /* ignore */ }
    };
    webCtx.webServer.register({
      kind: 'exact',
      path: '/watch-together/state',
      handler: async (req, res) => {
        const s = loadState();
        if (!s) return sendJson(res, 200, { ok: true, active: false });
        sendJson(res, 200, {
          ok: true,
          active: true,
          title: s.title,
          clock: fmt(elapsedOf(s)),
          duration: fmt(s.duration),
          paused: !!s.paused,
          auto: s.auto !== false,
          edge: !!(await bestVideo()),
        });
      },
    });
    webCtx.webServer.register({
      kind: 'exact',
      path: '/watch-together/cmd',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' });
        let body = '';
        try {
          for await (const chunk of req) body += chunk;
        } catch { /* ignore */ }
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch { /* ignore */ }
        const cmd = String(payload.cmd || '');
        try {
          if (cmd === 'stop') { clearState(); return sendJson(res, 200, { ok: true }); }
          if (cmd === 'mute') { const s = loadState(); if (s) { s.auto = false; saveState(s); } return sendJson(res, 200, { ok: true }); }
          if (cmd === 'unmute') { const s = loadState(); if (s) { s.auto = true; saveState(s); } return sendJson(res, 200, { ok: true }); }
          if (cmd === 'start') {
            const best = await bestVideo();
            if (!best) return sendJson(res, 200, { ok: false, error: '没找到正在播放的 B站页面' });
            let src = String(best.info.url || '');
            if (best.info.ep) src = 'https://www.bilibili.com/bangumi/play/ep' + best.info.ep;
            const meta = await resolveMeta(src);
            if (!meta) return sendJson(res, 200, { ok: false, error: '解析不了当前页面' });
            const next = {
              bvid: meta.bvid, title: meta.title, duration: meta.duration, cid: meta.cid,
              ep: meta.ep, epTitle: meta.epTitle,
              startedAt: Date.now() - Number(best.info.t) * 1000,
              paused: !!best.info.paused, pausedAt: 0, createdAt: Date.now(), auto: true,
            };
            saveState(next);
            return sendJson(res, 200, { ok: true, title: next.title });
          }
          return sendJson(res, 400, { ok: false, error: 'unknown cmd' });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
      },
    });
  });

  // ★ CMD_WATCH：/watch start|stop|status|sync <时间>|here
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: 'watch-together',
      name: 'watch',
      description: '一起看视频：start / stop / status / sync [mm:ss] / here',
      input: { hint: 'start|stop|status|sync 15:20|here', attachments: false },
      handler: async ({ rawInput }) => {
        const parts = String(rawInput || '').trim().split(/\s+/);
        const sub = (parts[0] || 'status').toLowerCase();
        const state = loadState();
        if (sub === 'start') {
          const best = await bestVideo();
          if (!best) return { kind: 'error', text: '没找到正在播放的 B站页面（陪看模式Edge 开着并放视频吗？）' };
          let src = String(best.info.url || '');
          if (best.info.ep) src = 'https://www.bilibili.com/bangumi/play/ep' + best.info.ep;
          const meta = await resolveMeta(src);
          if (!meta) return { kind: 'error', text: '解析不了当前页面。' };
          const next = {
            bvid: meta.bvid, title: meta.title, duration: meta.duration, cid: meta.cid,
            ep: meta.ep, epTitle: meta.epTitle,
            startedAt: Date.now() - Number(best.info.t) * 1000,
            paused: !!best.info.paused, pausedAt: 0, createdAt: Date.now(),
          };
          saveState(next);
          return { kind: 'success', text: '开始陪看《' + next.title + '》，已看到 ' + fmt(elapsedOf(next)) + '。' };
        }
        if (sub === 'auto') {
          const on = (parts[1] || '').toLowerCase() !== 'off';
          if (!state) return { kind: 'error', text: '现在没有在陪看。' };
          state.auto = on;
          saveState(state);
          return { kind: 'success', text: on ? '打开自动吐槽（画面上每 30 秒最多一句）' : '关掉自动吐槽' };
        }
        if (sub === 'stop') { clearState(); return { kind: 'success', text: '结束陪看。' }; }
        if (sub === 'here') {
          if (!state) return { kind: 'error', text: '现在没有在陪看。' };
          const line = await danmakuLine(state.cid, elapsedOf(state));
          return {
            kind: 'success',
            text: line ? '看到 ' + fmt(elapsedOf(state)) + '，弹幕在刷「' + line + '」' : '看到 ' + fmt(elapsedOf(state)) + '，这一刻没有弹幕。',
          };
        }
        if (sub === 'sync') {
          if (!state) return { kind: 'error', text: '现在没有在陪看。' };
          const raw = parts.slice(1).join(' ');
          let sec = NaN;
          let m = raw.match(/^(\d{1,2}):(\d{2})$/);
          if (m) sec = Number(m[1]) * 60 + Number(m[2]);
          else if ((m = raw.match(/(\d{1,2})\s*分\s*(\d{1,2})?/))) sec = Number(m[1]) * 60 + Number(m[2] || 0);
          if (!Number.isFinite(sec)) {
            const best = await bestVideo();
            if (best) sec = Number(best.info.t);
          }
          if (!Number.isFinite(sec)) return { kind: 'error', text: '没看懂这个时间，试试 /watch sync 15:20' };
          state.startedAt = Date.now() - sec * 1000;
          state.paused = false;
          saveState(state);
          return { kind: 'success', text: '同步到 ' + fmt(sec) + '。' };
        }
        if (!state) return { kind: 'success', text: '现在没有在陪看。用 /watch start 开始。' };
        return {
          kind: 'success',
          text: '《' + state.title + '》看到 ' + fmt(elapsedOf(state)) + ' / ' + fmt(state.duration) + (state.paused ? '（暂停中）' : ''),
        };
      },
    });
  });

  // 每轮把陪看状态注入系统提示
  ctx.systemPrompt.variable('watch_together', () => {
    const state = loadState();
    if (!state) return undefined;
    const el = elapsedOf(state);
    const tail = state.paused ? '现在是暂停着的' : `正放到 ${fmt(el)}`;
    return `你和用户在一起看《${state.title}》。${tail}。聊别的也没关系，但你清楚片子停在哪儿。`;
  });

  // ★ POLL_LOOP：每 2 秒读一次真实进度，让 watch_status 永远准
  const POLL_MS = Number(process.env.DSH_WATCH_POLL_MS || 2000);
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    const state = loadState();
    if (!state) return;
    busy = true;
    try {
      const best = await bestVideo();
      if (best && Number.isFinite(Number(best.info.t))) {
        const info = best.info;
        const drift = Math.abs(Date.now() - Number(state.startedAt || 0) - Number(info.t) * 1000) / 1000;
        if (drift > 2) state.startedAt = Date.now() - Number(info.t) * 1000;
        const wasPaused = !!state.paused;
        state.paused = !!info.paused;
        if (state.paused && !wasPaused) state.pausedAt = Date.now();
        if (!state.paused) state.pausedAt = 0;
        // 换片/换集：时长差 > 5 秒就重新解析
        if (Number(info.d) > 0 && Math.abs(Number(info.d) - Number(state.duration || 0)) > 5) {
          const meta = await resolveMeta(String(info.url || ""));
          if (meta) {
            state.bvid = meta.bvid; state.title = meta.title; state.duration = meta.duration; state.cid = meta.cid;
            state.ep = meta.ep; state.epTitle = meta.epTitle;
            log("switched to", meta.title);
          }
        }
        state.lastSeenAt = Date.now();
        saveState(state);
      } else {
        // 没有正在播的页面：超过 10 分钟没更新就当结束
        const lastSeen = Number(state.lastSeenAt || state.createdAt || 0);
        if (Date.now() - lastSeen > 10 * 60 * 1000) { clearState(); log("watch state expired"); }
      }
    } catch { /* ignore */ } finally { busy = false; }
  }, POLL_MS);
  try { timer.unref?.(); } catch { /* ignore */ }

  // 暴露一个方法给以后设置页用（先留个口）
  return () => {
    try { clearInterval(timer); } catch { /* ignore */ }
    try { if (autoTimer) clearInterval(autoTimer); } catch { /* ignore */ }
    log('unloaded');
  };
}
