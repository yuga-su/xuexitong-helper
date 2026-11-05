/* 假 DOM 测试台：验证 content.js 的「翻页 / 滑动课件」模块 */
const fs = require('fs');
const path = require('path');

const ALL = [];
const logLines = [];
const intervals = [];

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
    .some((p) => p.trim() && matchOne(el, p.trim()));
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
    this.disabled = false;
    this.title = '';
    this._scrollTop = opts.scrollTop || 0;
    this.scrollHeight = opts.scrollHeight || 0;
    this.clientHeight = opts.clientHeight || 0;
    this.clientWidth = opts.clientWidth || 0;
    this.style = {};
    this.listeners = {};
    this._clicks = 0;
    this._removed = false;
    this.classList = {
      contains: (c) => String(this.className).split(/\s+/).includes(c),
      add: (c) => {
        if (!this.classList.contains(c)) this.className = (this.className + ' ' + c).trim();
      },
      remove: (c) => {
        this.className = String(this.className)
          .split(/\s+/)
          .filter((x) => x !== c)
          .join(' ');
      }
    };
    ALL.push(this);
    (opts.kids || []).forEach((k) => this.appendChild(k));
    Object.assign(this.attrs, opts.attrs || {});
  }
  get innerText() {
    return [this.textContent, ...this.children.map((c) => c.innerText)].filter(Boolean).join(' ');
  }
  set innerText(v) {
    this.textContent = v;
    this.children = [];
  }
  get innerHTML() {
    return '';
  }
  set innerHTML(v) {}
  get parentElement() {
    return this.parent;
  }
  get isConnected() {
    if (this._removed) return false;
    if (this === body) return true;
    return !!this.parent;
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
  hasAttribute(n) {
    return this.attrs[n] != null;
  }
  getBoundingClientRect() {
    return { width: 20, height: 12, left: 0, top: 0, right: 20, bottom: 12 };
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
}

// 真浏览器的 scrollTop 会被滚到底部时夹住，假 DOM 也得夹，不然指纹一直在变
Object.defineProperty(El.prototype, 'scrollTop', {
  get() {
    return this._scrollTop || 0;
  },
  set(v) {
    const max = Math.max(0, (this.scrollHeight || 0) - (this.clientHeight || 0));
    this._scrollTop = Math.max(0, Math.min(Number(v) || 0, max));
  }
});

const MODE = process.env.FJ_SLIDE || 'button';
const doc = new El('html');
const body = new El('body');
doc.appendChild(body);

let pageEl = null;
let nextBtn = null;
let container = null;
let wheelCount = 0;
let page = 1;
const total = 3;
let imgEl = null;

function setPage(n) {
  page = n;
  if (pageEl) pageEl.textContent = n + '/' + total;
}

if (MODE === 'ananas') {
  // ananas PPT：整块 .ans-module-preview，一张图一页，按钮没有文字
  container = new El('div', { className: 'ans-module-preview', clientHeight: 600, scrollHeight: 4000, clientWidth: 800 });
  imgEl = new El('img', { className: 'ppt-page', clientWidth: 700, clientHeight: 500 });
  imgEl.src = 'a1.png';
  container.appendChild(imgEl);
  body.appendChild(container);
  nextBtn = new El('button', { className: 'ans-next', text: '' });
  nextBtn.addEventListener('click', () => {
    if (page >= total) return;
    page++;
    imgEl.src = 'a' + page + '.png';
    if (page >= total) nextBtn.disabled = true;
  });
  body.appendChild(nextBtn);
  // ananas 里常见的隐藏音视频占位：不能把它当成视频页
  const hiddenVideo = new El('video', { clientHeight: 0, clientWidth: 0 });
  hiddenVideo.duration = 30;
  body.appendChild(hiddenVideo);
} else if (MODE !== 'plain') {
  container = new El('div', { id: 'docContainer', clientHeight: 600, scrollHeight: 4000, clientWidth: 800 });
  pageEl = new El('span', { className: 'page-num', text: '1/' + total });
  container.appendChild(pageEl);
  body.appendChild(container);
  container.addEventListener('wheel', () => {
    wheelCount++;
    container.scrollTop = container.scrollTop + 400;
    if (page < total) setPage(page + 1);
  });
  if (MODE === 'button') {
    nextBtn = new El('button', { className: 'next-btn', text: '下一页' });
    nextBtn.addEventListener('click', () => {
      if (page < total) setPage(page + 1);
    });
    body.appendChild(nextBtn);
  }
}

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
  title: '课件 - 学习通',
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
  MODE === 'plain'
    ? { hostname: 'mooc1.chaoxing.com', pathname: '/mooc-ans/mycourse/studentview', href: 'http://mooc1.chaoxing.com/mooc-ans/mycourse/studentview' }
    : { hostname: 'mooc1.chaoxing.com', pathname: '/ananas/modules/doc/index.html', href: 'http://mooc1.chaoxing.com/ananas/modules/doc/index.html' };
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
  autoPlay: false,
  autoWork: false,
  discussAuto: false,
  confirmSend: false,
  closeAfterReply: false,
  autoSlide: MODE !== 'plain',
  slideEvery: 1,
  harvest: false
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

// 假时钟：slideTick 的节流靠 Date.now
let clock = 1000000;
const realDateNow = Date.now;
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

  ok(intervals.some((i) => i.ms === 1000), '注册了 1 秒的课件翻页定时器');
  ok(typeof msgListener === 'function', '消息监听已注册');

  // 模拟 12 秒：每秒推进时钟并跑一次所有定时器
  for (let k = 0; k < 80; k++) {
    clock += 1000;
    intervals.forEach((i) => {
      try {
        i.fn();
      } catch (e) {}
    });
    await wait(5);
  }
  await wait(200);

  const slideLogs = logLines.filter((l) => l.indexOf('课件') >= 0);
  const doneLog = slideLogs.some((l) => l.indexOf('最后一页') >= 0);

  if (MODE === 'button') {
    ok(nextBtn._clicks === 2, '点了 2 次「下一页」（实际 ' + nextBtn._clicks + '）');
    ok(page === 3, '翻到了第 3 页（实际 ' + page + '）');
    ok(doneLog, '到最后一页会自己停：' + (slideLogs[slideLogs.length - 1] || ''));
    ok(nextBtn._clicks === 2, '停手之后不再乱点');
    ok(wheelCount === 0, '有按钮时不乱滚（实际 ' + wheelCount + '）');
  } else if (MODE === 'ananas') {
    ok(nextBtn._clicks === 2, 'ananas：点了 2 次「下一页」（实际 ' + nextBtn._clicks + '）');
    ok(String(imgEl.src).endsWith('a3.png'), 'ananas：图换到 a3.png（实际 ' + imgEl.src + '）');
    ok(!slideLogs.some((l) => l.indexOf('视频页') >= 0), 'ananas：隐藏的音视频占位没把翻页挡掉');
    ok(
      slideLogs.some((l) => l.indexOf('翻不动') >= 0 || l.indexOf('最后一页') >= 0 || l.indexOf('滚到底') >= 0),
      'ananas：翻到底会收手：' + (slideLogs[slideLogs.length - 1] || '')
    );
  } else if (MODE === 'wheel') {
    ok(wheelCount >= 1, '没有按钮时用滚轮推进（滚了 ' + wheelCount + ' 次）');
    ok(page === 3, '滚轮把页码推到了 3/3（实际 ' + page + '）');
    ok(doneLog, '到底后停手：' + (slideLogs[slideLogs.length - 1] || ''));
  } else {
    ok(nextBtn === null, '非课件页没有翻页按钮');
    ok(wheelCount === 0, '非课件页不乱滚');
    ok(slideLogs.length === 0, '非课件页不打印课件日志（实际 ' + slideLogs.length + ' 条）');
  }

  // 弹窗那个「手动翻一页」按钮走的消息，别炸、要有回话
  if (MODE === 'ananas') {
    const resp = await Promise.race([
      new Promise((r) => {
        const ret = msgListener({ type: 'fj-slide-once' }, {}, r);
        if (ret !== true) r(null);
      }),
      new Promise((r) => realSetTimeout(() => r('timeout'), 9000))
    ]);
    ok(resp && resp !== 'timeout' && typeof resp.ok === 'boolean', '手动翻一页有回话：' + JSON.stringify(resp).slice(0, 70));
  }

  Date.now = realDateNow;
  if (fail.length) {
    console.log('SLIDE_TEST_FAIL ' + fail.join(' | '));
    process.exit(1);
  }
  console.log('SLIDE_TEST_OK');
})();