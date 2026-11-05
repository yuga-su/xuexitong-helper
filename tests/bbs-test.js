/* 假 DOM 测试台：验证 content.js 在 groupweb bbs 话题页上的行为 */
const fs = require('fs');

const ALL = [];
let logLines = [];
let sentMessages = [];
let aiCalls = [];

function matchSimple(el, sel) {
  sel = sel.trim();
  if (!sel) return false;
  // 组合：a.b[attr="v"]
  const re = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)$/;
  const m = re.exec(sel);
  if (!m) return false;
  const [, tag, cls, attrs] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (cls) {
    for (const part of cls.match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') {
        const have = String(el.className || '').split(/\s+/);
        if (!have.includes(part.slice(1))) return false;
      } else if (el.id !== part.slice(1)) {
        return false;
      }
    }
  }
  if (attrs) {
    const are = /\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]/g;
    let am;
    while ((am = are.exec(attrs))) {
      const [, name, op, val] = am;
      const got = name === 'id' ? el.id : el.dataset && name.startsWith('data-') ? el.dataset[name.slice(5)] : el.getAttribute(name);
      if (op === undefined) {
        if (got == null || got === '') return false;
      } else if (op === '=') {
        if (String(got) !== val) return false;
      } else if (op === '*=') {
        if (String(got).indexOf(val) < 0) return false;
      } else if (op === '^=') {
        if (String(got).indexOf(val) !== 0) return false;
      } else if (op === '$=') {
        if (!String(got).endsWith(val)) return false;
      }
    }
  }
  return true;
}

function match(el, sel) {
  return String(sel).split(',').some((part) => {
    part = part.trim();
    if (!part) return false;
    const segs = part.split(/\s+/);
    const last = segs[segs.length - 1];
    if (!matchSimple(el, last)) return false;
    let node = el.parent;
    for (let i = segs.length - 2; i >= 0; i--) {
      let found = false;
      while (node) {
        if (matchSimple(node, segs[i])) {
          found = true;
          break;
        }
        node = node.parent;
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
    this.dataset = {};
    this.className = opts.className || '';
    this.id = opts.id || '';
    this.type = opts.type || '';
    this.value = opts.value || '';
    this.textContent = opts.text || '';
    this.disabled = false;
    this.readOnly = false;
    this._clicked = 0;
    this.listeners = {};
    this.classList = {
      add: (c) => {
        if (!this.className.split(/\s+/).includes(c)) this.className = (this.className + ' ' + c).trim();
      },
      remove: (c) => {
        this.className = this.className.split(/\s+/).filter((x) => x !== c).join(' ');
      },
      contains: (c) => this.className.split(/\s+/).includes(c),
      toggle: (c) => {}
    };
    ALL.push(this);
    (opts.kids || []).forEach((k) => this.appendChild(k));
    Object.assign(this.attrs, opts.attrs || {});
  }
  get innerText() {
    const own = this.textContent || '';
    return [own, ...this.children.map((c) => c.innerText)].filter(Boolean).join(' ');
  }
  set innerText(v) {
    this.textContent = v;
    this.children = [];
  }
  get innerHTML() {
    return String(this.innerText).length + '';
  }
  set innerHTML(v) {}
  get isConnected() {
    if (this._removed) return false;
    if (this === body || this === doc) return true;
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
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      n.children.forEach((c) => {
        if (match(c, sel)) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
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
    return { width: 20, height: 12, top: 0, left: 0 };
  }
  focus() {}
  addEventListener(ev, fn) {
    (this.listeners[ev] = this.listeners[ev] || []).push(fn);
  }
  dispatchEvent(e) {
    (this.listeners[e.type] || []).forEach((fn) => fn(e));
    return true;
  }
  click() {
    this._clicked++;
    (this.listeners.click || []).forEach((fn) => fn({ type: 'click', target: this }));
  }
}

/* ---- 页面 ---- */
const MODE = process.env.FJ_MODE || 'bbs';
const doc = new El('html');
const body = new El('body');
doc.appendChild(body);

let editor, btn, btnCancel, oldReply, oldReplyDel, oldEditTa, oldEditBtn, oldSaveBtn;
const pageCalls = [];
let ta1001 = null;

if (MODE === 'bbs') {
  const title = new El('div', { className: 'topic-title', text: '数据库设计为什么要先做需求分析' });
  const reply1 = new El('div', { className: 'reply-item', text: '因为需求不清楚后面表结构全要返工' });
  const reply2 = new El('div', { className: 'reply-item', text: '老师上课说过需求分析决定实体和关系' });
  editor = new El('textarea', { className: 'reply-input' });
  btn = new El('button', { className: 'btn', text: '发表' });
  btnCancel = new El('button', { className: 'btn', text: '取消' });
  const wrap = new El('div', { className: 'reply-editor', kids: [editor, btn, btnCancel] });
  body.appendChild(title);
  body.appendChild(reply1);
  body.appendChild(reply2);
  body.appendChild(wrap);
  // 3.5：页面上已经有一条老口的 AI 回复（带「删除」按钮），发送新回复时要先删掉它
  if (process.env.FJ_OLD !== '0') {
    oldReplyDel = new El('span', { className: 'del', text: '删除' });
    oldReply = new El('div', {
      className: 'reply-item',
      text: '我觉得需求不清楚，后面表结构肯定白干，太离谱了！',
      kids: [oldReplyDel]
    });
    oldReplyDel.addEventListener('click', () => {
      oldReply.remove();
    });
    if (process.env.FJ_EDIT === '1') {
      // 这一版给旧回复配一个「编辑」入口和内联编辑器，验证优先走原位改
      oldEditTa = new El('textarea', { className: 'edit-input' });
      oldEditBtn = new El('span', { className: 'edit', text: '编辑' });
      oldSaveBtn = new El('button', { className: 'save', text: '保存' });
      oldReply.appendChild(oldEditTa);
      oldReply.appendChild(oldEditBtn);
      oldReply.appendChild(oldSaveBtn);
    }
    body.appendChild(oldReply);
  }
} else {
  // 课程学习页右栏：content2 > itemDiscuss(标题/回复数/回复列表/textarea#discuss1001)
  const item = new El('div', { className: 'itemDiscuss' });
  item.appendChild(new El('div', { className: 'topicTitle', text: '数据库设计为什么要先做需求分析' }));
  const cnt = new El('span', { text: '1' });
  cnt.id = 'replycount1001';
  item.appendChild(cnt);
  const list = new El('div');
  list.id = 'replaylist1001';
  list.appendChild(new El('div', { className: 'replyItem', text: '因为需求不清楚后面表结构全要返工' }));
  list.appendChild(new El('div', { className: 'replyItem', text: '老师上课说过需求分析决定实体和关系' }));
  item.appendChild(list);
  ta1001 = new El('textarea');
  ta1001.id = 'discuss1001';
  const relayta = new El('div', { className: 'replaytextarea', kids: [ta1001] });
  item.appendChild(relayta);
  const content2 = new El('div', { kids: [item] });
  content2.id = 'content2';
  body.appendChild(content2);
  editor = ta1001;
  btn = new El('button', { text: 'x' });
}

/* ---- 全局桩 ---- */
global.window = global;
global.top = global;
const winListeners = {};
global.addEventListener = (ev, fn) => {
  (winListeners[ev] = winListeners[ev] || []).push(fn);
};
global.postMessage = () => {};
const docListeners = {};
global.document = {
  body,
  head: body,
  title: '数据库设计讨论 - 超星学习通',
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
    if (e.bubbles) (winListeners[e.type] || []).forEach((fn) => fn(e));
    return true;
  },
  documentElement: doc,
  execCommand: () => false
};
global.location = MODE === 'bbs'
  ? { hostname: 'groupweb.chaoxing.com', pathname: '/course/topic/v3/bbs/4df31d42', href: 'http://groupweb.chaoxing.com/course/topic/v3/bbs/4df31d42' }
  : { hostname: 'mooc1.chaoxing.com', pathname: '/mooc-ans/mycourse/studentstudy', href: 'http://mooc1.chaoxing.com/mooc-ans/mycourse/studentstudy' };
global.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
global.CustomEvent = class {
  constructor(type, init) {
    this.type = type;
    this.detail = init && init.detail;
    this.bubbles = !!(init && init.bubbles);
  }
};

/* 冒充页面的 addDiscussReply：把对应 textarea 清空（真实页面就是这么干的） */
global.addEventListener('fj-page-call', (ev) => {
  let p;
  try {
    p = JSON.parse(ev.detail);
  } catch (e) {
    return;
  }
  pageCalls.push(p);
  if (p.name === 'addDiscussReply') {
    const ta = ALL.find((e) => e.id === 'discuss' + p.args[0]);
    if (ta) ta.value = '';
  }
});
global.Event = class {
  constructor(type) {
    this.type = type;
  }
};
global.KeyboardEvent = global.Event;
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};
global.getSelection = () => null;

const settings = {
  discussAuto: true,
  discussMax: 3,
  discussLen: 60,
  aiMode: 'bridge',
  aiUrl: 'http://127.0.0.1:17310/summarize',
  showPanel: false,
  confirmSend: true,
  closeAfterReply: process.env.FJ_CLOSE !== '0'
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
      sentMessages.push(msg);
      if (msg.type === 'fj-ai') {
        aiCalls.push(msg);
        if (cb) cb({ ok: true, text: '需求没谈清楚后面表结构全得返工，先把要什么说明白。' });
        return Promise.resolve({ ok: true, text: '需求没谈清楚后面表结构全得返工，先把要什么说明白。' });
      }
      if (msg.type === 'fj-log') logLines.push(msg.line);
      if (cb) cb({ ok: true });
      return Promise.resolve({ ok: true });
    },
    onMessage: {
      addListener: (fn) => {
        msgListener = fn;
      }
    }
  }
};

// 只让 sleep 生效，停掉所有轮询定时器
const realSetInterval = global.setInterval;
global.setInterval = () => 0;

require(require('path').join(__dirname, '..', 'content.js'));

const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));
const realSetTimeout = setTimeout;

(async () => {
  await wait(300);
  const fail = [];
  const waitFor = async (fn, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await wait(100);
    }
    return null;
  };
  const ok = (cond, label) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) fail.push(label);
  };
  ok(typeof msgListener === 'function', '消息监听已注册');
  ok(logLines.some((l) => l.includes('已注入')), '注入日志');

  // 触发“立刻回一条”
  msgListener({ type: 'fj-discuss-now' }, {}, () => {});
  await wait(1500);

  ok(aiCalls.length === 1, 'AI 只调一次（实际 ' + aiCalls.length + '）');
  if (aiCalls[0]) {
    ok(aiCalls[0].topic.includes('需求分析'), '话题标题抓到：' + aiCalls[0].topic.slice(0, 30));
    ok(Array.isArray(aiCalls[0].replies) && aiCalls[0].replies.length === 2, '同学发言抓到 ' + (aiCalls[0].replies || []).length + ' 条');
    ok(aiCalls[0].maxLen === 60, '字数上限传递 ' + aiCalls[0].maxLen);
  }

  // 3.3 发送前确认卡片
  const card = await waitFor(() => document.getElementById('fj-draft'), 4000);
  ok(!!card, '弹出确认卡片');
  const cardTa = card ? card.querySelector('.fj-d-text') : null;
  ok(!!cardTa && String(cardTa.value).length > 0, '卡片里预填了 AI 的话');
  ok(String(editor.value).length === 0, '没确认之前不往页面输入框塞字');
  const cardText = card ? String(card.innerText || '') : '';
  const hasNote = cardText.indexOf('旧的回复') >= 0;
  if (MODE !== 'bbs') {
    ok(!hasNote, '课程页不弹替换提示');
  } else if (process.env.FJ_OLD === '0') {
    ok(!hasNote, '没有旧回复时不提示');
  } else {
    ok(hasNote, '卡片提示会替换旧回复（' + cardText.slice(0, 50) + '）');
  }

  // 一键换一句
  const bRegen = card && card.querySelector('.fj-d-regen');
  if (bRegen) bRegen.dispatchEvent({ type: 'click' });
  await wait(900);
  ok(aiCalls.length === 2, '换一句重新调了一次 AI（实际 ' + aiCalls.length + '）');
  ok(aiCalls[1] && aiCalls[1].avoid === '需求没谈清楚后面表结构全得返工，先把要什么说明白。', '换一句带上了上一句做参照');
  ok(String(cardTa.value) === '需求没谈清楚后面表结构全得返工，先把要什么说明白。', '卡片文字被替换');

  // 手动点“发送”
  const bSend = card && card.querySelector('.fj-d-send');
  if (bSend) bSend.dispatchEvent({ type: 'click' });
  await wait(7000);
  ok(!document.getElementById('fj-draft'), '卡片已关闭');

  if (MODE === 'bbs') {
    // 走原位编辑时不会再往主回复框填字、也不点发表，只更新旧楼层
    if (process.env.FJ_EDIT !== '1') {
      ok(String(editor.value).length > 0, '输入框已填入：' + String(editor.value).slice(0, 30));
      ok(btn._clicked === 1, '点了发表按钮 ' + btn._clicked + ' 次');
      ok(logLines.some((l) => l.includes('已回复话题')), '成功日志');
    }
    ok(btnCancel._clicked === 0, '没误点取消按钮');
    if (process.env.FJ_EDIT === '1') {
      ok((oldEditBtn._clicked || 0) === 1, '点了旧回复的编辑 ' + (oldEditBtn._clicked || 0) + ' 次');
      ok(!oldReplyDel._clicked, '走编辑时不点删除');
      ok((oldSaveBtn._clicked || 0) === 1, '点了保存 ' + (oldSaveBtn._clicked || 0) + ' 次');
      ok(String(oldEditTa.value).length > 5, '新说法写进了旧楼层：' + String(oldEditTa.value).slice(0, 24));
      ok(logLines.some((l) => l.includes('原位替换')), '走了原位替换');
    } else if (process.env.FJ_OLD === '0') {
      ok(!oldReplyDel || oldReplyDel._clicked === undefined, '没有旧回复时不点删除');
    } else {
      ok(oldReplyDel._clicked === 1, '旧回复的删除按钮点了 ' + (oldReplyDel._clicked || 0) + ' 次');
      ok(!document.querySelector('.reply-item.del') && !!oldReply._removed, '旧回复已从页面消失');
      ok(logLines.some((l) => l.includes('先删掉这页上那条旧的 AI 回复')), '删除有日志');
    }
    await wait(2200);
    const closed = sentMessages.some((m) => m.type === 'fj-close-tab');
    if (process.env.FJ_CLOSE === '0') ok(!closed, '关掉开关后不关标签页');
    else ok(closed, '回复完发了关标签页指令');
  } else {
    ok(pageCalls.length === 1, '调用页面函数 ' + pageCalls.length + ' 次');
    ok(pageCalls[0] && pageCalls[0].name === 'addDiscussReply', '调的是 addDiscussReply');
    ok(pageCalls[0] && pageCalls[0].args[0] === '1001', '带上话题 id 1001');
    ok(editor.value === '', '页面已清空输入框（发送成功标志）');
    ok(logLines.some((l) => l.includes('已回复讨论[1001]')), '成功日志');
  }

  // 再跑一次应该跳过（已回过的 key）
  const before2 = aiCalls.length;
  msgListener({ type: 'fj-discuss-now' }, {}, () => {});
  await wait(1500);
  ok(aiCalls.length === before2, '第二次不再重复调 AI');

  // 清旧回复（页面上已经没有了，应该只打一句「没找到」）
  msgListener({ type: 'fj-purge-old' }, {}, () => {});
  await wait(600);
  ok(logLines.some((l) => l.includes('旧回复')), '清旧回复有结果日志');

  // 诊断
  msgListener({ type: 'fj-diag' }, {}, () => {});
  await wait(300);
  ok(logLines.some((l) => l.includes('诊断地址')), '诊断日志已输出');
  ok(logLines.some((l) => l.includes(MODE === 'bbs' ? '讨论页' : '课程学习页')), '诊断识别页面类型');

  if (fail.length) {
    console.log('--- 日志 ---');
    logLines.forEach((l) => console.log('  ' + l));
  }
  console.log(fail.length ? 'BBS_TEST_FAIL ' + JSON.stringify(fail) : 'BBS_TEST_OK');
  process.exit(fail.length ? 1 : 0);
})();