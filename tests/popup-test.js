/* 弹窗冒烟测试：验证「测试 AI」不再空指针 */
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'popup.js');
const code = fs.readFileSync(path, 'utf8');

const ALL = {};
function mk(sel, opts = {}) {
  const el = {
    _sel: sel,
    tagName: opts.tag || 'DIV',
    type: opts.type || '',
    value: opts.value == null ? '' : opts.value,
    checked: !!opts.checked,
    dataset: opts.dataset || {},
    textContent: opts.text || '',
    className: '',
    listeners: {},
    addEventListener(ev, fn) {
      (this.listeners[ev] = this.listeners[ev] || []).push(fn);
    },
    dispatch(ev) {
      (this.listeners[ev] || []).forEach((f) => f({ target: this }));
    },
    click() {
      this.dispatch('click');
    }
  };
  ALL[sel] = el;
  return el;
}

// 只有 data-key 的 prompt 文本框（没有 id，这正是当初报错的原因）
const fields = [
  mk('[data-key="discussLen"]', { tag: 'INPUT', type: 'number', value: '80', dataset: { key: 'discussLen' } }),
  mk('[data-key="aiPrompt"]', { tag: 'TEXTAREA', value: '像学生口吻', dataset: { key: 'aiPrompt' } }),
  mk('[data-key="aiMode"]', { tag: 'SELECT', value: 'bridge', dataset: { key: 'aiMode' } }),
  mk('[data-key="aiUrl"]', { tag: 'INPUT', type: 'text', value: 'http://127.0.0.1:17310/summarize', dataset: { key: 'aiUrl' } }),
  mk('[data-key="aiBase"]', { tag: 'INPUT', type: 'text', value: '', dataset: { key: 'aiBase' } }),
  mk('[data-key="aiKey"]', { tag: 'INPUT', type: 'password', value: '', dataset: { key: 'aiKey' } }),
  mk('[data-key="aiModel"]', { tag: 'INPUT', type: 'text', value: '', dataset: { key: 'aiModel' } }),
  mk('[data-key="discussMax"]', { tag: 'INPUT', type: 'number', value: '3', dataset: { key: 'discussMax' } }),
  mk('[data-key="discussAuto"]', { tag: 'INPUT', type: 'checkbox', checked: true, dataset: { key: 'discussAuto' } })
];
['#conn', '#aiInfo', '#aiState', '#save', '#log', '#cnt', '#bankInfo', '#statsLine', '#reload', '#clear', '#exportBank', '#importBank', '#bankFile', '#clearBank', '#discussNow', '#discussReset', '#diag'].forEach((s) => mk(s));

global.document = {
  querySelector: (s) => {
    if (ALL[s]) return ALL[s];
    const k = /\[data-key="([^"]+)"\]/.exec(s);
    if (k) return fields.find((f) => f.dataset.key === k[1]) || null;
    return null;
  },
  querySelectorAll: (s) => (s === '[data-key]' ? fields : []),
  createElement: () => mk('#tmp' + Math.random()),
  addEventListener: () => {}
};

let sent = null;
const store = {};
store.discussLen = 80;
store.aiPrompt = '像学生口吻';
global.chrome = {
  storage: {
    local: {
      get: (d, cb) => {
        const out = Object.assign({}, typeof d === 'object' ? d : {});
        for (const k in store) out[k] = store[k];
        if (cb) cb(out);
        return Promise.resolve(out);
      },
      set: (o, cb) => {
        Object.assign(store, o);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  },
  runtime: {
    lastError: null,
    sendMessage: (msg, cb) => {
      sent = msg;
      if (msg && msg.type === 'fj-ai') {
        if (cb) cb({ ok: true, text: '需求没说清后面全得返工。' });
        return Promise.resolve({ ok: true, text: '需求没说清后面全得返工。' });
      }
      if (cb) cb({ ok: true });
      return Promise.resolve({ ok: true });
    }
  },
  tabs: {
    query: (q, cb) => {
      cb([{ id: 1, url: 'http://groupweb.chaoxing.com/course/topic/v3/bbs/x' }]);
      return Promise.resolve([{ id: 1 }]);
    },
    sendMessage: (id, msg, cb) => cb && cb({ ok: true, top: true }),
    reload: () => {}
  }
};
global.window = { close: () => {} };
global.setInterval = () => 0;

// 执行 popup.js（顶层 const 在 function 作用域里执行，便于访问内部函数）
const run = new Function('document', 'chrome', 'window', code + '\nreturn { testAi };');
const api = run(global.document, global.chrome, global.window);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(120);
  await api.testAi();
  await wait(60);
  const fail = [];
  const ok = (c, l) => {
    console.log((c ? 'PASS ' : 'FAIL ') + l);
    if (!c) fail.push(l);
  };
  ok(!!sent && sent.type === 'fj-ai', '发出了 fj-ai 请求');
  ok(!!sent && sent.maxLen === 80, '字数上限读到 80（实际 ' + (sent && sent.maxLen) + '）');
  ok(!!sent && sent.prompt === '像学生口吻', '提示词读到「' + (sent && sent.prompt) + '」');
  ok(!String(ALL['#aiInfo'].textContent).includes('异常'), '没有异常文案：' + ALL['#aiInfo'].textContent.slice(0, 40));
  ok(String(ALL['#aiInfo'].textContent).includes('AI 通了'), '显示 AI 通了');
  console.log(fail.length ? 'POPUP_TEST_FAIL ' + JSON.stringify(fail) : 'POPUP_TEST_OK');
  process.exit(fail.length ? 1 : 0);
})();