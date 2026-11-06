/* 假 DOM 测试台：验证 1.0.5 参考油猴脚本加的三件事
 *  FJ_ENH=work  题库接口 {code,data:"A#B"} 的兼容 + 全角半角
 *  FJ_ENH=next  任务点没做完不跳下一节 + 按左侧目录树跳下一节
 */
const fs = require('fs');
const path = require('path');

const MODE = process.env.FJ_ENH || 'work';
const logLines = [];
const intervals = [];

function matchOne(el, sel) {
  sel = sel.trim();
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)$/.exec(sel);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  if (m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') {
        if (!String(el.className).split(/\s+/).includes(part.slice(1))) return false;
      } else if (el.id !== part.slice(1)) return false;
    }
  }
  if (m[3]) {
    const re = /\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]/g;
    let a;
    while ((a = re.exec(m[3]))) {
      const got = a[1] === 'id' ? el.id : el.getAttribute(a[1]);
      if (a[2] === undefined) {
        if (got == null || got === '') return false;
      } else if (a[2] === '=') {
        if (String(got) !== a[3]) return false;
      } else if (a[2] === '*=') {
        if (String(got).indexOf(a[3]) < 0) return false;
      }
    }
  }
  return true;
}
const match = (el, sel) => String(sel).split(',').some((p) => p.trim() && matchOne(el, p.trim()));

const ALL = [];
class El {
  constructor(tag, opts = {}) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.className = opts.className || '';
    this.id = opts.id || '';
    this.textContent = opts.text || '';
    this.value = opts.value || '';
    this.type = opts.type || '';
    this.disabled = false;
    this.checked = false;
    this.duration = opts.duration || 0;
    this.currentTime = 0;
    this.paused = true;
    this.muted = false;
    this.playbackRate = 1;
    this.scrollTop = 0;
    this.scrollHeight = opts.scrollHeight || 0;
    this.clientHeight = opts.clientHeight || 0;
    this.clientWidth = opts.clientWidth || 0;
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this._clicks = 0;
    this._removed = false;
    ALL.push(this);
  }
  get innerText() {
    return (this.textContent || '') + this.children.map((c) => c.innerText || '').join('');
  }
  set innerText(v) {
    this.textContent = v;
  }
  get isConnected() {
    return !this._removed && (!!this.parent || this === doc || this === body);
  }
  get parentElement() {
    return this.parent;
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    this._removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    if (k === 'id') return this.id || null;
    return k in this.attrs ? this.attrs[k] : null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      n.children.forEach((c) => {
        if (!c._removed && match(c, sel)) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  contains(node) {
    let n = node && node.parent;
    while (n) {
      if (n === this) return true;
      n = n.parent;
    }
    return false;
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (match(n, sel)) return n;
      n = n.parent;
    }
    return null;
  }
  getBoundingClientRect() {
    return { width: this.clientWidth || 20, height: this.clientHeight || 12, top: 0, left: 0 };
  }
  addEventListener(ev, fn) {
    (this.listeners[ev] = this.listeners[ev] || []).push(fn);
  }
  removeEventListener(ev, fn) {
    this.listeners[ev] = (this.listeners[ev] || []).filter((x) => x !== fn);
  }
  dispatchEvent(e) {
    (this.listeners[e.type] || []).forEach((fn) => fn(e));
    return true;
  }
  click() {
    this._clicks++;
    this.dispatchEvent({ type: 'click', target: this });
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

const doc = new El('html');
const body = new El('body');
doc.appendChild(body);

/* ---------------- 场景一：章节测验 ---------------- */
let q1A = null;
let q2A = null;

if (MODE === 'work') {
  const mkQ = (title, store) => {
    const q = new El('div', { className: 'TiMu' });
    const t = new El('div', { className: 'Zy_TItle', text: '【单选题】' + title });
    q.appendChild(t);
    const ul = new El('ul', { className: 'Zy_ulTop' });
    ['A', 'B'].forEach((k, i) => {
      const li = new El('li');
      const label = new El('label', { text: k + '．选项' + k });
      const input = new El('input', { type: 'radio' });
      input.value = String(i);
      label.appendChild(input);
      li.appendChild(label);
      ul.appendChild(li);
      if (i === 0) store(input);
    });
    q.appendChild(ul);
    body.appendChild(q);
  };
  mkQ('数据库设计的第一步是什么', (i) => (q1A = i));
  mkQ('需求分析的作用是什么', (i) => (q2A = i));
}

/* ---------------- 场景二：视频看完 + 任务点 ---------------- */
let video = null;
let jobIcon = null;
let jobBox = null;
let nextPointSpan = null;
const roundpoints = [];

if (MODE === 'next') {
  jobBox = new El('div', { className: 'ans-job' });
  jobIcon = new El('i', { className: 'ans-job-icon' });
  jobBox.appendChild(jobIcon);
  body.appendChild(jobBox);

  const tree = new El('div', { id: 'coursetree' });
  body.appendChild(tree);
  const mkPoint = (id, cls, txt) => {
    const p = new El('div', { id: id, className: 'roundpoint ' + cls, text: txt });
    const span = new El('span', { text: txt });
    span.className = 'pointText';
    p.appendChild(span);
    tree.appendChild(p);
    roundpoints.push(p);
    return { p, span, txt };
  };
  mkPoint('cur222', 'currents', '1.1 需求分析');
  const nx = mkPoint('cur333', '', '1.2 数据库设计');
  nextPointSpan = nx.span;

  const cid = new El('input', { id: 'chapterIdid' });
  cid.value = '222';
  body.appendChild(cid);

  video = new El('video', { duration: 200, clientHeight: 400, clientWidth: 800 });
  video.paused = false;
  video.currentTime = 0;
  body.appendChild(video);
}

/* ---------------- 全局桩 ---------------- */
const winListeners = {};
global.window = global;
global.top = global;
global.addEventListener = (ev, fn) => {
  (winListeners[ev] = winListeners[ev] || []).push(fn);
};
global.postMessage = () => {};
const docListeners = {};
global.document = {
  body,
  head: body,
  documentElement: doc,
  title: MODE === 'work' ? '章节测验' : '课程学习',
  activeElement: body,
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ text: t }),
  getElementById: (id) => ALL.find((e) => e.id === id && !e._removed) || null,
  querySelector: (s) => ALL.find((e) => !e._removed && match(e, s)) || null,
  querySelectorAll: (s) => ALL.filter((e) => !e._removed && match(e, s)),
  addEventListener: (ev, fn) => {
    (docListeners[ev] = docListeners[ev] || []).push(fn);
  },
  removeEventListener: (ev, fn) => {
    docListeners[ev] = (docListeners[ev] || []).filter((x) => x !== fn);
  },
  dispatchEvent: (e) => {
    (docListeners[e.type] || []).forEach((fn) => fn(e));
    return true;
  },
  execCommand: () => false
};
global.location =
  MODE === 'work'
    ? {
        hostname: 'mooc1.chaoxing.com',
        pathname: '/mooc-ans/work/doHomeWorkNew',
        search: '?courseId=1&clazzid=2&workId=3',
        href: 'http://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1'
      }
    : {
        hostname: 'mooc1.chaoxing.com',
        pathname: '/mooc-ans/mycourse/studentstudy',
        search: '?courseId=1&clazzid=2&chapterId=222',
        href: 'http://mooc1.chaoxing.com/mooc-ans/mycourse/studentstudy?courseId=1'
      };
global.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });

class Ev {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init || {});
  }
}
global.Event = Ev;
global.CustomEvent = Ev;
global.KeyboardEvent = Ev;
global.MouseEvent = Ev;
global.WheelEvent = Ev;
global.PointerEvent = Ev;
global.TouchEvent = Ev;
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};
global.getSelection = () => null;

// 题库接口：muketool 那种 {code:1,data:"A#B"}
global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 1, data: 'A' })
});

const settings = {
  showPanel: false,
  autoPlay: MODE === 'next',
  mute: true,
  rate: 1,
  autoNext: true,
  autoWork: MODE === 'work',
  autoSubmit: false,
  autoSlide: false,
  strictNext: true,
  apiUrl: MODE === 'work' ? 'http://mock.tiku/api' : '',
  apiKey: '',
  fallback: 'first',
  localBank: '',
  skipGuess: false,
  harvest: false,
  discussAuto: false,
  confirmSend: false,
  closeAfterReply: false,
  fontWarn: true
};
let msgListener = null;
global.chrome = {
  storage: {
    local: {
      get: (d, cb) => {
        const out = typeof d === 'object' && !Array.isArray(d) ? Object.assign({}, d, settings) : settings;
        if (cb) cb(out);
        return Promise.resolve(out);
      },
      set: (o, cb) => {
        if (cb) cb();
        return Promise.resolve();
      }
    },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    sendMessage: (msg, cb) => {
      if (msg.type === 'fj-log') logLines.push(msg.line);
      if (cb) cb({ ok: true });
      return Promise.resolve({ ok: true });
    },
    onMessage: { addListener: (fn) => (msgListener = fn) }
  }
};

let clock = 1000000;
Date.now = () => clock;
global.setInterval = (fn, ms) => {
  intervals.push({ fn, ms });
  return 0;
};

require(path.join(__dirname, '..', 'content.js'));

const realSetTimeout = setTimeout;
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));

(async () => {
  await wait(300);
  const fail = [];
  const ok = (cond, label) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) fail.push(label);
  };

  const run = async (ms) => {
    clock += ms;
    intervals.forEach((i) => {
      try {
        i.fn();
      } catch (e) {}
    });
    await wait(30);
  };

  if (MODE === 'work') {
    for (let k = 0; k < 6; k++) await run(1000);
    await wait(400);
    ok(!!(q1A && q1A.checked), '题库返回 {code:1,data:"A"} 时选了 A（第 1 题）');
    ok(!!(q2A && q2A.checked), '题库返回 {code:1,data:"A"} 时选了 A（第 2 题）');
    ok(
      logLines.some((l) => l.indexOf('第 2 题') >= 0 || l.indexOf('API') >= 0),
      '答题有日志：' + (logLines.filter((l) => l.indexOf('题') >= 0).slice(-1)[0] || '无')
    );
  } else {
    // 先跑一下视频 tick，让它挂上 ended 监听
    await run(1000);
    ok(video.listeners.ended && video.listeners.ended.length > 0, '视频 ended 监听已挂上');

    // 任务点还没完成 → 不该跳
    video.listeners.ended.forEach((fn) => fn({ type: 'ended', target: video }));
    await wait(3200);
    ok(
      logLines.some((l) => l.indexOf('任务点没完成') >= 0),
      '任务点没做完时不跳下一节：' + (logLines[logLines.length - 1] || '')
    );
    ok(nextPointSpan._clicks === 0, '这时没点下一节的目录节点');

    // 任务点完成后再结束 → 按目录树跳
    jobBox.className = 'ans-job ans-job-finished';
    clock += 12000;
    video.listeners.ended.forEach((fn) => fn({ type: 'ended', target: video }));
    await wait(3400);
    ok(nextPointSpan._clicks >= 1, '任务点完成后按目录树点了下一节（点了 ' + nextPointSpan._clicks + ' 次）');
    ok(
      logLines.some((l) => l.indexOf('按目录跳到下一节') >= 0),
      '有「按目录跳到下一节」日志：' + (logLines[logLines.length - 1] || '')
    );
  }

  if (fail.length) {
    console.log('ENHANCE_TEST_FAIL ' + fail.join(' | '));
    process.exit(1);
  }
  console.log('ENHANCE_TEST_OK');
})();