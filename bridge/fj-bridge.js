/*!
 * 学习通助手 · 本地 AI 桥（3.0）
 * 作用：给浏览器扩展提供一个本地 HTTP 接口，用桌面 DSH / DeepSeek 的 key 生成
 *      「章节讨论一句话总结」，扩展自己不带 key、不直连外网。
 *
 * 用法：
 *   1) 双击 bridge\启动AI桥.bat
 *   2) 浏览器扩展弹窗里 AI 桥地址填 http://127.0.0.1:17310/summarize
 *
 * key 来源优先级：
 *   环境变量 DS_API_KEY → FJ_API_KEY → DEEPSEEK_API_KEY → bridge\config.json 的 apiKey
 *
 * 零依赖，Node 18+ 直接跑（内置 fetch）。
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  port: 17310,
  baseURL: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.7,
  maxTokens: 400
};

function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  } catch (e) {
    file = {};
  }
  const envKey =
    process.env.DS_API_KEY ||
    process.env.FJ_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    '';
  const cfg = Object.assign({}, DEFAULT_CONFIG, file);
  cfg.apiKey = envKey || file.apiKey || '';
  cfg.port = Number(process.env.FJ_BRIDGE_PORT || file.port || DEFAULT_CONFIG.port);
  return cfg;
}

function systemPrompt(maxLen) {
  return [
    '你在替一名大学生在学习通讨论区回帖。',
    '任务：读完话题和同学们已有的发言，用一句客观、平实的话把要点说清楚。',
    '硬性要求：',
    '1. 只写一句陈述句，中文，不超过 ' + maxLen + ' 字。',
    '2. 客观陈述，用「多数同学认为」「普遍的看法是」「可以从……角度理解」这类说法。',
    '3. 禁止第一人称评价：「我觉得」「我认为」「我个人」「说实话」一律不许写。',
    '4. 禁止夸张口语和情绪词：真能、白干、挖坑、绝了、离谱、救命、寄了、狠狠、爆改；不用感叹号、不用反问句、不用表情。',
    '5. 不复述话题原句，不评价别人说得对错，只讲共识加上一句成立的理由。',
    '6. 只输出这一句话本身，不要引号、不要「总结：」前缀、不要解释、不要 Markdown、不要换行。'
  ].join('\n');
}

function buildUser(topic, replies, avoid) {
  const lines = [];
  lines.push('话题：' + String(topic || '').trim().slice(0, 1200));
  if (avoid) lines.push('上一句是「' + String(avoid).slice(0, 160) + '」，换一种说法，别跟它撞。');
  if (replies && replies.length) {
    lines.push('同学们已有的发言：');
    replies.slice(0, 8).forEach((r, i) => {
      lines.push(i + 1 + '. ' + String(r || '').replace(/\s+/g, ' ').trim().slice(0, 300));
    });
  } else {
    lines.push('（暂时还没有人发言，请客观陈述一个站得住的说法）');
  }
  lines.push('现在写出那句话，只输出句子本身。');
  return lines.join('\n');
}

function cleanText(text, maxLen) {
  let s = String(text || '').trim();
  s = s.replace(/^```[\s\S]*?\n/, '').replace(/```$/,'');
  s = s.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
  s = s.replace(/^["'“”『』「」\s]+|["'“”『』「」\s]+$/g, '');
  s = s.replace(/^(总结|回复|答)[：:]\s*/, '');
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

async function callModel(cfg, topic, replies, maxLen, customPrompt, avoid) {
  if (!cfg.apiKey) {
    const err = new Error(
      '没找到 API Key。请在 bridge/config.json 里填 {"apiKey":"sk-..."}，' +
        '或者启动前 set DS_API_KEY=sk-...'
    );
    err.status = 400;
    throw err;
  }
  const base = String(cfg.baseURL || '').replace(/\/+$/, '');
  const url = base + '/chat/completions';
  const body = {
    model: cfg.model || 'deepseek-chat',
    temperature: Number(cfg.temperature) || 0.7,
    max_tokens: Number(cfg.maxTokens) || 400,
    messages: [
      { role: 'system', content: customPrompt ? String(customPrompt).slice(0, 2000) + '\n不超过 ' + maxLen + ' 字，只输出这一句话。' : systemPrompt(maxLen) },
      { role: 'user', content: buildUser(topic, replies, avoid) }
    ]
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    const raw = await r.text();
    if (!r.ok) {
      let tip = '';
      if (r.status === 401 || r.status === 403) tip = '（Key 不对，或者这个 Key 不属于 ' + base + '）';
      else if (r.status === 404) tip = '（模型名 ' + body.model + ' 在该网关不存在，改 config.json 的 model）';
      else if (/not activated/i.test(raw)) tip = '（这个模型没开通，换 model 或在该网关开通）';
      const err = new Error('上游接口 ' + r.status + '：' + raw.slice(0, 300) + tip);
      err.status = 502;
      throw err;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error('上游返回不是 JSON：' + raw.slice(0, 200));
    }
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    const text = msg && (msg.content || '');
    if (!text) throw new Error('上游没有返回内容：' + raw.slice(0, 200));
    return cleanText(text, maxLen);
  } finally {
    clearTimeout(timer);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      buf += c;
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'cache-control': 'no-store'
  });
  res.end(text);
}

const cfg = loadConfig();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    send(res, 200, {
      ok: true,
      service: 'fj-bridge',
      version: '3.0',
      model: cfg.model,
      baseURL: cfg.baseURL,
      hasKey: !!cfg.apiKey,
      hint: cfg.apiKey ? 'OK' : '需要在 bridge/config.json 填 apiKey，或设置环境变量 DS_API_KEY'
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/summarize') {
    try {
      const raw = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch (e) {
        body = {};
      }
      const topic = body.topic || '';
      const replies = Array.isArray(body.replies) ? body.replies : [];
      const maxLen = Math.min(Math.max(Number(body.maxLen) || 60, 15), 300);
      if (!String(topic).trim()) {
        send(res, 400, { ok: false, error: 'topic 不能为空' });
        return;
      }
      const text = await callModel(cfg, topic, replies, maxLen, body.prompt, body.avoid);
      console.log('[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] 已生成：' + text);
      send(res, 200, { ok: true, text, model: cfg.model });
    } catch (e) {
      console.error('[错误]', e && e.message ? e.message : e);
      send(res, e && e.status ? e.status : 500, { ok: false, error: String((e && e.message) || e) });
    }
    return;
  }

  send(res, 404, { ok: false, error: 'not found' });
});

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.log('端口 ' + cfg.port + ' 已经有桥在跑了 —— 说明 AI 桥是活的，直接用就行。');
    console.log('要重启的话，先把那个黑窗口关掉（或任务管理器结束 node.exe），再双击本文件。');
    process.exit(0);
  }
  console.log('桥启动失败：' + (e && e.message ? e.message : e));
  process.exit(1);
});

server.listen(cfg.port, '127.0.0.1', () => {
  console.log('==============================================');
  console.log(' 学习通助手 · 本地 AI 桥已启动');
  console.log(' 地址：http://127.0.0.1:' + cfg.port + '/summarize');
  console.log(' 模型：' + cfg.model + ' @ ' + cfg.baseURL);
  console.log(' Key ：' + (cfg.apiKey ? '已配置（…' + cfg.apiKey.slice(-6) + '）' : '未配置，去 bridge/config.json 填 apiKey'));
  console.log(' 这个窗口别关，关了扩展就调不到 AI 了');
  console.log('==============================================');
  selfCheck();
});

// 启动后自检一次：拿 1 个 token 试模型，把结果直接打在窗口里，省得用户来回猜
async function selfCheck() {
  if (!cfg.apiKey) {
    console.log('[自检] 没有 Key，跳过。');
    return;
  }
  const base = String(cfg.baseURL || '').replace(/\/+$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 8,
        messages: [{ role: 'user', content: '回复两个字：通了' }]
      }),
      signal: ctl.signal
    });
    const raw = await r.text();
    if (r.ok) console.log('[自检] ✅ 上游可用，模型 ' + cfg.model + ' 能出话。');
    else console.log('[自检] ❌ 上游 ' + r.status + '：' + raw.slice(0, 220));
  } catch (e) {
    console.log('[自检] ❌ 连不上上游 ' + base + '：' + (e && e.message ? e.message : e));
  } finally {
    clearTimeout(timer);
  }
}