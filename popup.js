/*!
 * 学习通助手 · 测试版
 * 弹窗逻辑：设置读写、连接检测、日志轮询
 */

const DEFAULTS = {
  autoPlay: true,
  mute: true,
  rate: 2,
  autoNext: true,
  autoVideoQuiz: true,
  autoWork: true,
  autoSubmit: false,
  showPanel: true,
  apiUrl: '',
  apiKey: '',
  fallback: 'first',
  videoQuizFallback: 'first',
  localBank: '',
  skipGuess: false,
  harvest: true,
  discussAuto: false,
  discussMax: 3,
  confirmSend: true,
  closeAfterReply: true,
  discussLen: 60,
  aiMode: 'bridge',
  aiUrl: 'http://127.0.0.1:17310/summarize',
  aiBase: '',
  aiKey: '',
  aiModel: '',
  aiPrompt: '',
  autoSlide: true,
  slideEvery: 2
};

const $ = (s) => document.querySelector(s);
const on = (sel, ev, fn) => {
  const el = $(sel);
  if (el) el.addEventListener(ev, fn);
};
const bind = (sel, fn) => on(sel, 'click', fn);
const inputs = Array.from(document.querySelectorAll('[data-key]'));

let currentTab = null;
let saveTimer = null;

function flash(text) {
  const el = $('#save');
  if (!el) return;
  const old = el.textContent;
  el.textContent = text;
  setTimeout(() => {
    el.textContent = old;
  }, 1100);
}

async function restore() {
  const s = await chrome.storage.local.get(DEFAULTS);
  inputs.forEach((el) => {
    const k = el.dataset.key;
    if (el.type === 'checkbox') el.checked = !!s[k];
    else el.value = s[k] == null ? '' : s[k];
  });
}

function collect() {
  const out = {};
  inputs.forEach((el) => {
    const k = el.dataset.key;
    if (el.type === 'checkbox') out[k] = el.checked;
    else if (k === 'rate') out[k] = Number(el.value) || 1;
    else if (k === 'discussMax') out[k] = Math.min(Math.max(Number(el.value) || 3, 1), 20);
    else if (k === 'discussLen') out[k] = Math.min(Math.max(Number(el.value) || 60, 15), 200);
    else if (k === 'slideEvery') out[k] = Math.min(Math.max(Number(el.value) || 2, 1), 15);
    else out[k] = el.value;
  });
  return out;
}

async function save(showTip) {
  await chrome.storage.local.set(collect());
  if (showTip) flash('已保存');
}

function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(false), 400);
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (e) {
    return null;
  }
}

function ping() {
  const conn = $('#conn');
  const setConn = (text, cls) => {
    if (!conn) return;
    conn.textContent = text;
    conn.className = cls;
  };
  if (!currentTab) {
    setConn('无标签页', 'pill off');
    return;
  }
  try {
    chrome.tabs.sendMessage(currentTab.id, { type: 'fj-ping' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        setConn('未注入', 'pill off');
      } else {
        setConn(resp.top ? '已连接' : '子框架', 'pill on');
      }
    });
  } catch (e) {
    setConn('未注入', 'pill off');
  }
}

async function pullLogs() {
  if (!currentTab) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'fj-get-logs', tabId: currentTab.id });
    const logs = (res && res.logs) || [];
    const pre = $('#log');
    pre.textContent = logs.length
      ? logs.map((x) => x.line).join('\n')
      : '暂无日志，打开学习通页面后会自动出现。';
    pre.scrollTop = pre.scrollHeight;
    $('#cnt').textContent = logs.length ? '(' + logs.length + ')' : '';
  } catch (e) {
    // service worker 冷启动瞬间可能失败，忽略
  }
}

/* ---------- 题库管理（2.0） ---------- */

function normKey(s) {
  return String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：？！“”‘’（）()【】\[\]《》<>·,.;:?!'"`~]/g, '')
    .toLowerCase();
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36) + '_' + s.length;
}

function synthKey(q, type) {
  return hashStr((type || '') + '|' + normKey(q));
}

async function renderBank() {
  try {
    const o = await chrome.storage.local.get({ fj_bank: {}, fj_stats: { right: 0, wrong: 0 } });
    const bank = o.fj_bank || {};
    const n = Object.keys(bank).length;
    const s = o.fj_stats || {};
    const total = (s.right || 0) + (s.wrong || 0);
    const acc = total ? Math.round(((s.right || 0) / total) * 100) : 0;
    $('#bankInfo').textContent = n + ' 条';
    $('#statsLine').textContent = total
      ? '正确率：' + acc + '%（对 ' + (s.right || 0) + ' / 错 ' + (s.wrong || 0) + '）' + (s.lastScore ? ' · 最近得分 ' + s.lastScore : '')
      : '正确率：暂无数据（提交后自动统计）';
  } catch (e) {}
}

async function exportBank() {
  const o = await chrome.storage.local.get({ fj_bank: {}, localBank: '', fj_stats: null });
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    bank: o.fj_bank || {},
    localBank: o.localBank || '',
    stats: o.fj_stats || null
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fj-bank-' + Date.now() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  flash('已导出');
}

async function importBank(file) {
  try {
    const data = JSON.parse(await file.text());
    const cur = (await chrome.storage.local.get({ fj_bank: {} })).fj_bank || {};
    let n = 0;
    const addOne = (q, ans, type) => {
      const k = synthKey(q, type || '');
      if (!k || !ans) return;
      if (!cur[k]) {
        cur[k] = { ans: String(ans).trim().slice(0, 300), q: String(q).slice(0, 120), type: type || '', t: Date.now(), hit: 0, right: 0 };
        n++;
      }
    };
    if (data && typeof data === 'object' && !Array.isArray(data) && data.bank) {
      for (const k in data.bank) {
        const rec = data.bank[k];
        if (!rec || !rec.ans) continue;
        if (!cur[k]) {
          cur[k] = { ans: rec.ans, q: rec.q || '', type: rec.type || '', t: rec.t || Date.now(), hit: rec.hit || 0, right: rec.right || 0 };
          n++;
        }
      }
      if (data.localBank) {
        const lb = (await chrome.storage.local.get({ localBank: '' })).localBank || '';
        const add = String(data.localBank).trim();
        if (add && lb.indexOf(add) < 0) {
          await chrome.storage.local.set({ localBank: lb ? lb + '\n' + add : add });
        }
      }
    } else if (Array.isArray(data)) {
      data.forEach((it) => {
        if (!it) return;
        addOne(it.q || it.question || it.title, it.a || it.answer || it.ans, it.type);
      });
    } else if (data && typeof data === 'object') {
      for (const q in data) {
        if (q === 'version' || q === 'exportedAt' || q === 'stats') continue;
        addOne(q, typeof data[q] === 'object' ? data[q].ans || data[q].answer : data[q], '');
      }
    }
    await chrome.storage.local.set({ fj_bank: cur });
    await renderBank();
    flash('导入 ' + n + ' 条');
  } catch (e) {
    flash('导入失败');
  }
}

/* ---------- AI / 讨论（3.0） ---------- */

function aiCfgFromForm() {
  const v = collect();
  return {
    mode: v.aiMode,
    url: v.aiUrl,
    base: v.aiBase,
    key: v.aiKey,
    model: v.aiModel,
    prompt: v.aiPrompt
  };
}

function fieldValue(key) {
  // 页面元素可能被改版改掉，取不到就回退到已保存的设置，别让弹窗直接炸
  const el = document.querySelector('[data-key="' + key + '"]');
  return el ? el.value : DEFAULTS[key];
}

async function testAi() {
  setAiInfo('正在问 AI…', '测试中', '');
  try {
    const cfg = aiCfgFromForm();
    const res = await chrome.runtime.sendMessage({
      type: 'fj-ai',
      cfg,
      topic: '数据库设计为什么要先做需求分析？',
      replies: ['因为需求不清楚后面表结构全要返工', '老师上课说过需求分析决定实体和关系'],
      maxLen: Math.min(Math.max(Number(fieldValue('discussLen')) || 60, 15), 200),
      prompt: String(fieldValue('aiPrompt') || '')
    });
    if (res && res.ok) {
      const who = res.modelSwitched ? '已自动换模型 ' + res.model + ' · ' : res.model ? res.model + ' · ' : '';
      setAiInfo('AI 通了（' + who + '）' + res.text, '可用', 'on');
    } else {
      setAiInfo('AI 失败：' + ((res && res.error) || '无响应'), '不通', 'danger');
    }
  } catch (e) {
    setAiInfo('AI 调用异常：' + String(e), '异常', 'danger');
  }
}

function setAiInfo(msg, tagText, cls) {
  const info = $('#aiInfo');
  const state = $('#aiState');
  if (info) info.textContent = msg;
  if (state) {
    state.textContent = tagText;
    state.className = 'tag' + (cls ? ' ' + cls : '');
  }
}

async function checkBridge() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'fj-ai-health', cfg: aiCfgFromForm() });
    if (res && res.ok) {
      const d = res.data || {};
      setAiInfo(
        '桥在线 · ' + (d.model || '未知模型') + (d.hasKey ? '' : ' · 但 config.json 没填 Key'),
        '桥在线',
        'on'
      );
    } else {
      const u = (res && res.url) || 'http://127.0.0.1:17310/health';
      setAiInfo('桥没开（' + u + ' 连不上）：双击 bridge\\启动AI桥.bat，黑窗口别关', '桥离线', 'danger');
    }
  } catch (e) {
    setAiInfo('桥检测失败：' + String(e), '桥离线', 'danger');
  }
}

async function discussNow() {
  if (!currentTab) {
    flash('没找到标签页');
    return;
  }
  chrome.tabs.sendMessage(currentTab.id, { type: 'fj-discuss-now' }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.top) flash('主页面未注入');
    else flash('已触发');
  });
}

async function discussReset() {
  if (!currentTab) return;
  try {
    await chrome.storage.local.set({ fj_replied: {} });
    chrome.tabs.sendMessage(currentTab.id, { type: 'fj-discuss-reset' }, () => {});
    flash('已清空');
  } catch (e) {}
}

function purgeOld() {
  if (!currentTab) return flash('没找到标签页');
  chrome.tabs.sendMessage(currentTab.id, { type: 'fj-purge-old' }, (resp) => {
    if (chrome.runtime.lastError || !resp) flash('主页面未注入，先刷新一下');
    else flash('正在清，看日志');
  });
  setTimeout(pullLogs, 900);
}

async function init() {
  await restore();

  inputs.forEach((el) => {
    el.addEventListener('change', () => {
      autoSave();
      if (el.dataset.key === 'rate') flash('倍速已更新');
    });
    if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'password') {
      el.addEventListener('input', autoSave);
    }
  });

  on('#save', 'click', () => save(true));

  on('#reload', 'click', async () => {
    if (currentTab) {
      try {
        chrome.tabs.reload(currentTab.id);
        window.close();
      } catch (e) {
        flash('重载失败');
      }
    }
  });

  on('#clear', 'click', async () => {
    if (!currentTab) return;
    try {
      await chrome.runtime.sendMessage({ type: 'fj-clear-logs', tabId: currentTab.id });
      const lg = $('#log');
      if (lg) lg.textContent = '已清空';
      const ct = $('#cnt');
      if (ct) ct.textContent = '';
    } catch (e) {}
  });

  on('#exportBank', 'click', exportBank);
  on('#importBank', 'click', () => {
    const f = $('#bankFile');
    if (f) f.click();
  });
  on('#bankFile', 'change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) await importBank(f);
    e.target.value = '';
  });
  on('#clearBank', 'click', async () => {
    await chrome.storage.local.set({ fj_bank: {} });
    await renderBank();
    flash('题库已清空');
  });
  renderBank();

  bind('#aiTest', testAi);
  bind('#discussNow', discussNow);
  bind('#discussReset', discussReset);
  bind('#purgeOld', purgeOld);
  bind('#diag', () => {
    if (!currentTab) return flash('没找到标签页');
    chrome.tabs.sendMessage(currentTab.id, { type: 'fj-diag' }, (resp) => {
      if (chrome.runtime.lastError || !resp) flash('主页面未注入，先刷新一下');
      else flash('诊断已写入日志');
    });
    setTimeout(pullLogs, 600);
  });

  currentTab = await getActiveTab();
  ping();
  pullLogs();
  checkBridge();

  setInterval(pullLogs, 1200);
  setInterval(ping, 4000);
}

init();