/*!
 * 学习通助手 · 3.0
 * Service Worker：日志中转（按标签页存到 storage.session）、角标状态、
 *                 AI 中转（章节讨论一句话总结：本地 AI 桥 / 直连 OpenAI 兼容接口）
 */

const MAX_LINES = 200;

/* ================= AI 中转 ================= */

const AI_DEFAULT_URL = 'http://127.0.0.1:17310/summarize';

function aiSysPrompt(maxLen, custom) {
  if (custom) {
    return String(custom).slice(0, 2000) + '\n用中文，不超过 ' + maxLen + ' 字，只输出这一句话本身。';
  }
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

function aiUserPrompt(topic, replies, avoid) {
  const lines = ['话题：' + String(topic || '').trim().slice(0, 1200)];
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

function aiClean(text, maxLen) {
  let s = String(text || '').trim();
  s = s.replace(/^```[\s\S]*?\n/, '').replace(/```$/, '');
  s = s.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
  s = s.replace(/^["'“”『』「」\s]+|["'“”『』「」\s]+$/g, '');
  s = s.replace(/^(总结|回复|答)[：:]\s*/, '');
  s = s.replace(/^(我觉得|我认为|我个人认为|个人认为|说实话)[，,]?\s*/, '');
  s = s.replace(/！/g, '。').replace(/!+/g, '。');
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

async function aiSummarize(msg) {
  const cfg = msg.cfg || {};
  const topic = String(msg.topic || '').slice(0, 1200);
  const replies = Array.isArray(msg.replies) ? msg.replies : [];
  const maxLen = Math.min(Math.max(Number(msg.maxLen) || 60, 15), 300);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 40000);
  try {
    let url;
    let body;
    const headers = { 'content-type': 'application/json' };
    if (cfg.mode === 'direct') {
      const base = String(cfg.base || '').replace(/\/+$/, '');
      if (!base) throw new Error('直连模式要先填 Base URL');
      url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
      if (cfg.key) headers.authorization = 'Bearer ' + cfg.key;
      body = {
        model: cfg.model || 'deepseek-chat',
        temperature: 0.7,
        max_tokens: 400,
        messages: [
          { role: 'system', content: aiSysPrompt(maxLen, msg.prompt) },
          { role: 'user', content: aiUserPrompt(topic, replies, msg.avoid) }
        ]
      };
    } else {
      url = cfg.url || AI_DEFAULT_URL;
      body = { topic, replies, maxLen, avoid: msg.avoid || '', prompt: msg.prompt || '' };
    }

    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal
    }).catch((e) => {
      if (e && e.name === 'AbortError') throw new Error('AI 请求 40 秒没响应');
      throw new Error(
        (cfg.mode === 'direct' ? '连不上 AI 服务 ' : '连不上 AI 桥 ') +
          url +
          '（桥没开？双击 bridge\\启动AI桥.bat 那个黑窗口要一直开着）'
      );
    });
    const raw = await r.text();
    if (!r.ok) throw new Error('AI 接口 ' + r.status + '：' + raw.slice(0, 220));
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error('AI 返回不是 JSON：' + raw.slice(0, 160));
    }
    let text = '';
    if (cfg.mode === 'direct') {
      text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    } else {
      text = data && (data.text || data.answer || '');
    }
    if (!text) throw new Error('AI 没返回内容：' + raw.slice(0, 160));
    return { ok: true, text: aiClean(text, maxLen) };
  } finally {
    clearTimeout(timer);
  }
}

async function pushLog(tabId, entry) {
  const key = 'log_' + tabId;
  const got = await chrome.storage.session.get(key);
  const arr = got[key] || [];
  arr.push(entry);
  while (arr.length > MAX_LINES) arr.shift();
  await chrome.storage.session.set({ [key]: arr });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ ok: false });
        return;
      }

      if (msg.type === 'fj-log') {
        const tabId = sender.tab && sender.tab.id;
        if (tabId != null) {
          await pushLog(tabId, {
            t: Date.now(),
            line: msg.line || '',
            level: msg.level || 'info'
          });
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'fj-get-logs') {
        const got = await chrome.storage.session.get('log_' + msg.tabId);
        sendResponse({ logs: got['log_' + msg.tabId] || [] });
        return;
      }

      if (msg.type === 'fj-clear-logs') {
        await chrome.storage.session.remove('log_' + msg.tabId);
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'fj-ai') {
        try {
          sendResponse(await aiSummarize(msg));
        } catch (e) {
          let first = String((e && e.message) || e);
          const cfg = msg.cfg || {};
          // 桥挂了但弹窗里填了直连的 base + key，就自己试一次直连，别让用户白等
          if (cfg.mode !== 'direct' && cfg.base && cfg.key) {
            try {
              const out = await aiSummarize(Object.assign({}, msg, { cfg: Object.assign({}, cfg, { mode: 'direct' }) }));
              if (out && out.ok) {
                out.text = out.text;
                sendResponse({ ok: true, text: out.text, fallback: 'direct' });
                return;
              }
            } catch (e2) {
              first += '；直连也不行：' + String((e2 && e2.message) || e2);
            }
          }
          sendResponse({ ok: false, error: first });
        }
        return;
      }

      if (msg.type === 'fj-close-tab') {
        const tabId = sender.tab && sender.tab.id;
        if (tabId != null) {
          try {
            await chrome.tabs.remove(tabId);
          } catch (e) {}
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'fj-ai-health') {
        const cfg = msg.cfg || {};
        const home = String(cfg.url || AI_DEFAULT_URL).replace(/\/[^/]*$/, '');
        const health = home.replace(/\/+$/, '') + '/health';
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 4000);
        try {
          const r = await fetch(health, { signal: ctl.signal });
          const data = await r.json().catch(() => ({}));
          sendResponse({ ok: r.ok && data.ok !== false, url: health, data });
        } catch (e) {
          sendResponse({ ok: false, url: health, error: '桥没开' });
        } finally {
          clearTimeout(timer);
        }
        return;
      }

      if (msg.type === 'fj-badge') {
        const tabId = sender.tab && sender.tab.id;
        if (tabId != null) {
          try {
            await chrome.action.setBadgeBackgroundColor({ tabId, color: '#7c3aed' });
            await chrome.action.setBadgeText({ tabId, text: String(msg.text || '').slice(0, 4) });
          } catch (e) {}
        }
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, unknown: msg.type });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  // 异步 sendResponse，保持通道
  return true;
});

// 标签页关闭时清缓存
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('log_' + tabId).catch(() => {});
});