/* 假 DOM 测试：讨论入口要进「教师发布的讨论」，不能点学习讨论区 */
const fs = require('fs');
const path = require('path');

const ALL = [];
const logLines = [];

function matchOne(el, sel) {
  sel = sel.trim();
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)$/.exec(sel);
  if (!m) return false;
  const tag = m[1];
  const cls = m[2];
  const attrs = m[3];
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (cls) {
    for (const part of cls.match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') {
        if (!String(el.className).split(/\s+/).includes(part.slice(1))) return false;
      } else if (el.id !== part.slice(1)) return false;
    }
  }
  if (attrs) {
    const re = /\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]/g;
    let a;
    while ((a = re.exec(attrs))) {
      const got = a[1] === 'id' ? el.id : el.getAttribute(a[1]);
      if (a[2] === undefined) {
        if (got == null || got === '') return false;
      } else if (a[2] === '=') {
        if (String(got) !== a[3]) return false;
      } else if (a[2] === '*=') {
        if (String(got).indexOf(a[3]) < 0) return false;
      } else if (a[2] === '^=') {
        if (String(got).indexOf(a[3]) !== 0) return false;
      }
    }
  }
  return true;
}

function match(el, sel) {
  return String(sel)
    .split(',')
    .some((part) => {
      const p = part.trim();
      if (!p) return false;
      const tokens = p.split(/\s+/);
      if (tokens.length === 1) return matchOne(el, tokens[0]);
      if (!matchOne(el, tokens[tokens.length - 1])) return false;
      let n = el.parent;
      for (let i = tokens.length - 2; i >= 0; i--) {
        let found = false;
        while (n) {
          if (matchOne(n, tokens[i])) { found = true; n = n.parent; break; }
          n = n.parent;
        }
        if (!found) return false;
      }
      return true;
    });
}

class El {
  constructor(tag, opts = {}) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.className = opts.className || '';
    this.id = opts.id || '';
    this.textContent = opts.text || '';
    this.value = '';
    this.title = '';
    this.style = {};
    this.listeners = {};
    this._clicks = 0;
    this._removed = false;
    ALL.push(this);
    (opts.kids || []).forEach((k) => this.appendChild(k));
  }
  get innerText() {
    return [this.textContent, ...this.children.map((c) => c.innerText)].filter(Boolean).join(' ');
  }
  get parentElement() {
    return this.parent;
  }
  get isConnected() {
    if (this._removed) return false;
    return this === body || !!this.parent;
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    this.children = this.children.filter((x) => x !== c);
    c.parent = null;
  }
  remove() {
    this._removed = true;
    if (this.parent) this.parent.removeChild(this);
  }
  getAttribute(n) {
    if (n === 'class') return this.className;
    if (n === 'id') return this.id;
    return this.attrs[n] == null ? null : this.attrs[n];
  }
  setAttribute(n, v) {
    this.attrs[n] = v;
  }
  getBoundingClientRect() {
    return { width: 40, height: 20, left: 0, top: 0, right: 40, bottom: 20 };
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (match(n, sel)) return n;
      n = n.parent;
    }
    return null;
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
  addEventListener(ev, fn) {
    (this.listeners[ev] = this.listeners[ev] || []).push(fn);
  }
  dispatchEvent(e) {
    (this.listeners[e.type] || []).forEach((fn) => fn(e));
    return true;
  }
  click() {
    this._clicks++;
    this.dispatchEvent({ type: 'click', target: this });
  }
}

const body = new El('body');
const doc = new El('html');
doc.appendChild(body);

const NO_ENTRY = process.env.FJ_NOENTRY === '1';

// 学习讨论区的 tab —— 绝对不能点
const tit2 = new El('div', { id: 'tit2', text: '讨论' });
body.appendChild(tit2);

// 章节任务点里的「教师发布的讨论」
let chapterEntry = null;
if (!NO_ENTRY) {
  const list = new El('div', { id: 'chapterList' });
  chapterEntry = new El('div', { className: 'chapter_item', text: '3.1 讨论：数据库设计为什么要先做需求分析' });
  chapterEntry.addEventListener('click', () => {
    const box = new El('div', { id: 'content2' });
    const item = new El('div', { className: 'itemDiscuss' });
    const ta = new El('textarea', { id: 'discuss1001' });
    item.appendChild(ta);
    box.appendChild(item);
    body.appendChild(box);
  });
  list.appendChild(chapterEntry);
  body.appendChild(list);
}

global.window = global;
global.top = global;
global.addEventListener = () => {};
global.postMessage = () => {};
const docListeners = {};
global.document = {
  body,
  head: body,
  documentElement: doc,
  title: '章节 - 学习通',
  activeElement: body,
  createElement: (t) => new El(t),
  getElementById: (id) => ALL.find((e) => e.id === id && !e._removed) || null,
  querySelector: (s) => ALL.find((e) => !e._removed && match(e, s)) || null,
  querySelectorAll: (s) => ALL.filter((e) => !e._removed && match(e, s)),
  addEventListener: (ev, fn) => {
    (docListeners[ev] = docListeners[ev] || []).push(fn);
  },
  removeEventListener: () => {},
  dispatchEvent: (e) => {
    (docListeners[e.type] || []).forEach((fn) => fn(e));
    return true;
  },
  execCommand: () => false
};
global.location = {
  hostname: 'mooc1.chaoxing.com',
  pathname: '/mooc-ans/mycourse/studentstudy',
  search: '?courseId=1&clazzid=2',
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

const settings = {
  showPanel: false,
  discussAuto: false,
  discussFallbackTab: process.env.FJ_FALLBACK === '1',
  confirmSend: false,
  autoSlide: false,
  autoPlay: false
};
let msgListener = null;
global.chrome = {
  storage: {
    local: {
      get: (d, cb) => {
        const out = Object.assign({}, d, settings);
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
global.setInterval = () => 0;

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

  const resp = await new Promise((resolve) => {
    const ret = msgListener({ type: 'fj-discuss-enter' }, {}, resolve);
    if (ret !== true) resolve(null);
    realSetTimeout(() => resolve('timeout'), 6000);
  });

  ok(resp && resp !== 'timeout', '立刻进讨论有回话');
  if (process.env.FJ_FALLBACK === '1' && NO_ENTRY) {
    ok(tit2._clicks >= 1, '打开「退回学习讨论区」后才会点它（点了 ' + tit2._clicks + ' 次）');
  } else {
    ok(tit2._clicks === 0, '没点学习讨论区（点了 ' + tit2._clicks + ' 次）');
  }

  if (NO_ENTRY) {
    ok(resp && resp.ok === false, '没有入口时如实回报失败');
    ok(
      logLines.some((l) => l.indexOf('没找到教师发布的讨论入口') >= 0),
      '日志说清「没找到教师发布的讨论入口」'
    );
  } else {
    ok(chapterEntry._clicks === 1, '点了章节里的「讨论」任务点（点了 ' + chapterEntry._clicks + ' 次）');
    ok(resp && resp.ok === true, '回报进入成功：' + JSON.stringify(resp && resp.how));
    ok(
      logLines.some((l) => l.indexOf('进入教师发布的讨论') >= 0),
      '日志写了从哪个入口进的'
    );
  }

  if (fail.length) {
    console.log('DISCUSS_ENTRY_FAIL ' + fail.join(' | '));
    process.exit(1);
  }
  console.log('DISCUSS_ENTRY_OK');
})();