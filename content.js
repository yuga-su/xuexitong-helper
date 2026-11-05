/*!
 * 学习通助手 · 2.0
 * 功能：自动播放 / 静音 / 倍速 / 自动下一节 / 视频弹题 / 章节测验自动作答
 *       本地题库（自动回收正确答案 + 导入导出 + 命中统计）/ 正确率统计
 * 全部本地运行，不上传任何数据。
 */
(() => {
  'use strict';

  if (window.__FJ_CX__) return;
  window.__FJ_CX__ = true;

  const IS_TOP = (() => {
    try {
      return window.top === window;
    } catch (e) {
      return false;
    }
  })();

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
    /* ---- 章节讨论 AI 一句话 ---- */
    discussAuto: false,
    discussEntry: '',
    discussFallbackTab: false,
    discussMax: 3,
    discussLen: 60,
    confirmSend: true,
    closeAfterReply: true,
    aiMode: 'bridge',
    aiUrl: 'http://127.0.0.1:17310/summarize',
    aiBase: '',
    aiKey: '',
    aiModel: '',
    aiPrompt: '',
    /* ---- 翻页 / 滑动课件 ---- */
    autoSlide: true,
    slideEvery: 2
  };

  const S = Object.assign({}, DEFAULTS);

  const st = {
    video: null,
    lastTime: -1,
    stuck: 0,
    lastNextAt: 0,
    workBusy: false,
    lastWorkAt: 0,
    submitted: false,
    logs: [],
    panel: null,
    bank: null,
    cache: null,
    bankStore: null,
    stats: null,
    lastHarvestAt: 0,
    lastStatsAt: 0,
    noVideo: 0,
    lastKick: 0,
    /* 讨论 */
    replied: null,
    discussBusy: false,
    lastDiscussAt: 0,
    discussForce: false,
    /* 课件 */
    slideSig: "",
    slideTry: 0,
    slideStuck: 0,
    slideLastTry: 0,
    slideChangedAt: 0,
    slideWarned: false,
    slideDone: false,
    slidePages: "",
    slideSkipLog: ""
  };

  const boundVideos = new WeakSet();

  /* ================= 基础工具 ================= */

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) return '--:--';
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    return (h ? String(h) + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function norm(s) {
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

  function log(text, level) {
    level = level || 'info';
    const line = '[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] ' + text;
    st.logs.push(line);
    if (st.logs.length > 150) st.logs.shift();
    try {
      chrome.runtime.sendMessage({ type: 'fj-log', line, level });
    } catch (e) {}
    if (level === 'warn') console.warn('[学习通助手]', text);
    else if (level === 'error') console.error('[学习通助手]', text);
    else console.log('[学习通助手]', text);
    if (IS_TOP) renderPanel();
  }

  /* ================= 设置 ================= */

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(DEFAULTS, (items) => {
          if (!chrome.runtime.lastError && items) Object.assign(S, items);
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  function applySettings() {
    if (IS_TOP) {
      if (S.showPanel) ensurePanel();
      else if (st.panel) {
        st.panel.remove();
        st.panel = null;
      }
    }
    if (st.video) applyVideoPrefs(st.video);
    if (S.autoPlay && st.video && st.video.paused) tryPlay(st.video);
  }

  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        let touched = false;
        for (const k in changes) {
          if (k in DEFAULTS) {
            S[k] = changes[k].newValue === undefined ? DEFAULTS[k] : changes[k].newValue;
            touched = true;
          }
          if (k === 'fj_bank') st.bankStore = changes[k].newValue || {};
          if (k === 'fj_stats') st.stats = changes[k].newValue || { right: 0, wrong: 0 };
        }
        if (touched) {
          if (changes.localBank) st.bank = null;
          applySettings();
        }
      });
    } catch (e) {}
  }

  /* ================= 悬浮面板 ================= */

  function ensurePanel() {
    if (!IS_TOP) return null;
    if (st.panel && st.panel.isConnected) return st.panel;

    const el = document.createElement('div');
    el.id = 'fj-cx-panel';
    el.innerHTML =
      '<div class="fj-head">' +
      '<i class="fj-dot"></i><b>学习通助手</b><em>测试版</em>' +
      '<span class="fj-min" title="折叠/展开">—</span>' +
      '</div>' +
      '<div class="fj-body">' +
      '<div class="fj-status">初始化…</div>' +
      '<div class="fj-bank">题库加载中…</div>' +
      '<div class="fj-log"></div>' +
      '<div class="fj-foot">日志双击可复制 · 本地运行</div>' +
      '</div>';

    document.documentElement.appendChild(el);

    const head = el.querySelector('.fj-head');
    let drag = null;
    head.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('fj-min')) return;
      drag = { x: e.clientX, y: e.clientY, l: el.offsetLeft, t: el.offsetTop };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      el.style.left = drag.l + (e.clientX - drag.x) + 'px';
      el.style.top = drag.t + (e.clientY - drag.y) + 'px';
      el.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => {
      drag = null;
    });
    el.querySelector('.fj-min').addEventListener('click', () => el.classList.toggle('fj-collapsed'));
    el.querySelector('.fj-log').addEventListener('dblclick', () => {
      const text = st.logs.join('\n');
      navigator.clipboard && navigator.clipboard.writeText(text).then(
        () => log('日志已复制到剪贴板'),
        () => {}
      );
    });

    st.panel = el;
    renderPanel();
    return el;
  }

  function statusText() {
    // slide 状态在面板上单独显示，这里只负责视频/答题
    const parts = [];
    const v = st.video;
    if (v && v.isConnected) {
      parts.push(
        (v.paused ? '暂停' : '播放') +
          ' ' +
          fmtTime(v.currentTime) +
          '/' +
          fmtTime(v.duration) +
          ' @' +
          (v.playbackRate || 1) +
          'x'
      );
    } else {
      parts.push('无视频');
    }
    const qs = $$('.questionLi, .TiMu').length;
    if (qs) parts.push('题目 ' + qs);
    if (st.workBusy) parts.push('答题中');
    return parts.join(' · ');
  }

  function renderPanel() {
    if (!IS_TOP || !S.showPanel) return;
    const p = ensurePanel();
    if (!p) return;
    const s = p.querySelector('.fj-status');
    if (s) s.textContent = statusText();
    const b = p.querySelector('.fj-bank');
    if (b) b.textContent = bankText();
    const l = p.querySelector('.fj-log');
    if (l) {
      l.textContent = st.logs.slice(-7).join('\n');
      l.scrollTop = l.scrollHeight;
    }
  }

  /* ================= 视频控制 ================= */

  function applyVideoPrefs(v) {
    if (!v) return;
    try {
      const wantMute = !!S.mute;
      if (v.muted !== wantMute) v.muted = wantMute;
      const rate = Number(S.rate) || 1;
      if (v.playbackRate !== rate) v.playbackRate = rate;
    } catch (e) {}
  }

  function pickVideo() {
    const vids = $$('video');
    if (!vids.length) return null;
    let best = null;
    for (const v of vids) {
      if (!best) {
        best = v;
        continue;
      }
      const dv = (v.duration || 0) * (v.isConnected ? 1 : 0);
      const db = (best.duration || 0) * (best.isConnected ? 1 : 0);
      if (dv > db) best = v;
    }
    return best;
  }

  function attachVideo(v) {
    if (!v || st.video === v) return;
    st.video = v;
    if (!boundVideos.has(v)) {
      boundVideos.add(v);
      v.addEventListener('ended', onVideoEnded);
      v.addEventListener('pause', () => {
        if (S.autoPlay && !v.ended) setTimeout(() => tryPlay(v), 600);
      });
      v.addEventListener('ratechange', () => {
        if (Number(S.rate) && v.playbackRate !== Number(S.rate)) {
          setTimeout(() => {
            try {
              v.playbackRate = Number(S.rate);
            } catch (e) {}
          }, 300);
        }
      });
    }
    log('发现视频' + (isFinite(v.duration) && v.duration ? '，时长 ' + fmtTime(v.duration) : ''));
    applyVideoPrefs(v);
  }

  function tryPlay(v) {
    if (!v || !v.isConnected || v.ended) return;
    applyVideoPrefs(v);
    if (v.paused) {
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  const BIG_PLAY_SEL = [
    '.vjs-big-play-button',
    '.prism-big-play-btn',
    '#video .play',
    '.pausebg',
    '.vjs-play-control',
    'button[title*="播放"]',
    '.xgplayer-start',
    '.xgplayer-play',
    '.ans-video-play'
  ];

  function kickPlay() {
    if (!S.autoPlay) return;
    if (Date.now() - (st.lastKick || 0) < 6000) return;
    for (const s of BIG_PLAY_SEL) {
      const el = $(s);
      if (el && visible(el)) {
        st.lastKick = Date.now();
        log('未开始播放，点了播放按钮 ' + s, 'warn');
        try {
          el.click();
        } catch (e) {}
        return;
      }
    }
  }

  function onVideoEnded() {
    log('视频播放完毕');
    st.lastTime = -1;
    try {
      window.top.postMessage({ __fj: 'video-ended' }, '*');
    } catch (e) {}
    if (IS_TOP && S.autoNext) setTimeout(nextChapter, 2500);
  }

  function videoTick() {
    if (!S.autoPlay) return;
    const v = pickVideo();
    if (!v) {
      st.noVideo = (st.noVideo || 0) + 1;
      if (st.noVideo >= 4) {
        st.noVideo = 0;
        kickPlay();
      }
      return;
    }
    st.noVideo = 0;
    attachVideo(v);
    tryPlay(v);
    if (v.paused && (v.currentTime || 0) < 0.3) kickPlay();

    if (!v.paused) {
      if (Math.abs(v.currentTime - st.lastTime) < 0.05) {
        st.stuck++;
        if (st.stuck >= 12) {
          log('播放卡住，尝试恢复', 'warn');
          try {
            v.currentTime = Math.min(v.duration - 0.5, v.currentTime + 0.4);
            v.play();
          } catch (e) {}
          st.stuck = 0;
        }
      } else {
        st.stuck = 0;
        st.lastTime = v.currentTime;
      }
    }
  }

  /* ================= 自动下一节 ================= */

  function findNextButton() {
    const direct = ['#prevNextFocusNext', '.prevNextFocusNext', '#nextChapter', '.nextChapter', '#nextNode'];
    for (const s of direct) {
      const el = $(s);
      if (el && visible(el)) return el;
    }
    const words = ['下一节', '下一章', '下一节 >', '下一章 >', '下一个'];
    const nodes = $$('a, button, span, div');
    for (const el of nodes) {
      if (el.children.length > 2) continue;
      const t = (el.innerText || '').trim();
      if (words.indexOf(t) >= 0 && visible(el)) return el;
    }
    return null;
  }

  function nextChapter() {
    if (!IS_TOP || !S.autoNext) return;
    if (Date.now() - st.lastNextAt < 8000) return;
    const btn = findNextButton();
    if (!btn) {
      log('未找到"下一节"按钮，等待手动操作', 'warn');
      return;
    }
    st.lastNextAt = Date.now();
    log('点击下一节：' + (btn.innerText || '').trim().slice(0, 12));
    try {
      btn.click();
    } catch (e) {
      log('下一节点击失败：' + e.message, 'error');
    }
    setTimeout(videoTick, 2500);
  }

  /* ================= 视频弹题 ================= */

  const VQ_SEL = ['#videoquiz', '.ans-videoquiz', '.ans-videoquiz-box', '[id*="videoquiz"]', '[class*="videoquiz"]'];

  function findVideoQuiz() {
    for (const s of VQ_SEL) {
      const hit = $$(s).find((el) => visible(el) && (el.innerText || '').trim().length > 2);
      if (hit) return hit;
    }
    return null;
  }

  function quizSubmit(box) {
    const cands = $$('a, button, div, span', box).filter((el) => {
      const t = (el.innerText || '').trim();
      return visible(el) && el.children.length <= 1 && /^(提交|确定|继续|继续播放|我知道了)$/.test(t);
    });
    if (cands.length) {
      cands[0].click();
      return true;
    }
    const cls = $$('[class*="submit"], [class*="Submit"], [class*="btn"]', box).find(visible);
    if (cls) {
      cls.click();
      return true;
    }
    return false;
  }

  function videoQuizTick() {
    if (!S.autoVideoQuiz) return;
    const box = findVideoQuiz();
    if (!box || box.dataset.fjDone === '1') return;

    const inputs = $$('input[type=radio], input[type=checkbox]', box);
    const items = $$('li', box).filter((li) => (li.innerText || '').trim().length > 0);
    const opts = items.length ? items : $$('label', box);
    if (!inputs.length && !opts.length) return;

    box.dataset.fjDone = '1';

    if (inputs.length) {
      if (inputs[0].type === 'checkbox') {
        inputs.forEach((i) => {
          if (!i.checked) i.click();
        });
      } else {
        let idx = 0;
        if (S.videoQuizFallback === 'random') idx = Math.floor(Math.random() * inputs.length);
        if (!inputs[idx].checked) inputs[idx].click();
      }
    } else if (opts.length) {
      const idx = S.videoQuizFallback === 'random' ? Math.floor(Math.random() * opts.length) : 0;
      const label = opts[idx].querySelector('label') || opts[idx];
      label.click();
    }

    log('视频弹题已自动作答');
    setTimeout(() => {
      if (!quizSubmit(box)) log('弹题没找到提交按钮，可能需要手动点一下', 'warn');
    }, 600);
  }

  /* ================= 章节测验自动答题 ================= */

  function isWorkPage() {
    if (/\/work\/|\/exam\/|dowork|doHomeWork|\/mooc-ans\/work/i.test(location.href)) return true;
    return !!$('#submitBtn, .completeBtn');
  }

  function findQuestions() {
    let els = $$('.questionLi');
    if (!els.length) els = $$('.TiMu');
    if (!els.length) {
      els = $$('[id^="question"], [class*="questionLi"]').filter(
        (el) => $('input[type=radio], input[type=checkbox], textarea, input[type=text]', el)
      );
    }
    return els.filter((el, i) => els.indexOf(el) === i && !els.some((o) => o !== el && o.contains(el)));
  }

  const TYPE_NAMES = ['单选题', '多选题', '判断题', '填空题', '简答题', '论述题', '名词解释', '单选', '多选', '判断', '填空', '简答', '论述'];

  function detectType(raw, inputs) {
    for (const t of TYPE_NAMES) {
      if (raw.indexOf(t) >= 0) {
        if (t.indexOf('多选') === 0) return 'multi';
        if (t.indexOf('判断') === 0) return 'judge';
        if (t.indexOf('填空') === 0) return 'blank';
        if (t.indexOf('简答') === 0 || t.indexOf('论述') === 0 || t.indexOf('名词解释') === 0) return 'text';
        return 'single';
      }
    }
    if (inputs.length) {
      if (inputs.every((i) => i.type === 'checkbox')) return 'multi';
      if (inputs.every((i) => i.type === 'radio')) return 'single';
    }
    if ($('textarea, input[type=text]')) return 'blank';
    return 'single';
  }

  function parseQuestion(el) {
    const rawAll = (el.innerText || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

    let titleEl = $('.Zy_TItle, .mark_name, .question-title, .stem, h3', el);
    let raw = rawAll;

    if (titleEl) {
      raw = (titleEl.innerText || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
    } else {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('ul, ol, .answerList, .Zy_ulTop, input, textarea, label').forEach((n) => n.remove());
      raw = (clone.innerText || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
    }

    const inputs = $$('input[type=radio], input[type=checkbox]', el);
    const type = detectType(raw, inputs);

    let text = raw
      .replace(/^\s*\d+\s*[.、,，)）]\s*/, '')
      .replace(/^[【\[(（]\s*[^】\])）]{1,8}[】\])）]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 400) text = text.slice(0, 400);

    let optEls = $$('.Zy_ulTop > li, .answerList > li, .optionList > li, ul.opt-list > li', el);
    if (!optEls.length) {
      optEls = $$('li', el).filter((li) => li.querySelector('input') || /^[A-H][、.．\s]/.test((li.innerText || '').trim()));
    }
    optEls = optEls.filter((li, i) => optEls.indexOf(li) === i);

    const options = optEls.map((li) => {
      const t = (li.innerText || '').replace(/\s+/g, ' ').trim();
      return { el: li, text: t.slice(0, 200) };
    });

    const blanks = $$('input[type=text], textarea, [contenteditable="true"]', el);

    return {
      el,
      raw,
      text,
      type,
      options,
      optEls,
      inputs,
      blanks,
      key: hashStr(type + '|' + norm(text))
    };
  }

  /* ---------- 本地题库 / 正确率（2.0） ---------- */

  const BANK_KEY = 'fj_bank';
  const STATS_KEY = 'fj_stats';
  const ANS_RE = /正确答案\s*[：:]\s*([^\n]{1,300})/;
  let bankSaveTimer = null;

  function loadBankStore() {
    if (st.bankStore) return Promise.resolve(st.bankStore);
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ fj_bank: {} }, (o) => {
          st.bankStore = (o && o.fj_bank) || {};
          resolve(st.bankStore);
        });
      } catch (e) {
        st.bankStore = {};
        resolve(st.bankStore);
      }
    });
  }

  function saveBankStore() {
    clearTimeout(bankSaveTimer);
    bankSaveTimer = setTimeout(() => {
      const store = st.bankStore || {};
      const keys = Object.keys(store);
      if (keys.length > 20000) {
        keys.sort((a, b) => (store[a].t || 0) - (store[b].t || 0));
        keys.slice(0, keys.length - 20000).forEach((k) => delete store[k]);
      }
      try {
        chrome.storage.local.set({ [BANK_KEY]: store });
      } catch (e) {}
    }, 1200);
  }

  function bankPut(key, q, ansStr) {
    if (!key || !ansStr) return false;
    st.bankStore = st.bankStore || {};
    const old = st.bankStore[key];
    if (old && norm(old.ans) === norm(ansStr)) return false;
    st.bankStore[key] = {
      ans: String(ansStr).trim().slice(0, 300),
      q: (q && q.text ? q.text : '').slice(0, 120),
      type: (q && q.type) || '',
      t: Date.now(),
      hit: old ? old.hit || 0 : 0,
      right: old ? old.right || 0 : 0
    };
    saveBankStore();
    return true;
  }

  function bankText() {
    const n = st.bankStore ? Object.keys(st.bankStore).length : 0;
    const s = st.stats || {};
    const total = (s.right || 0) + (s.wrong || 0);
    const acc = total ? Math.round(((s.right || 0) / total) * 100) + '%' : '--';
    return '题库 ' + n + ' 条 · 答对 ' + (s.right || 0) + '/' + total + '（' + acc + '）';
  }

  function loadStats() {
    if (st.stats) return Promise.resolve(st.stats);
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ fj_stats: { right: 0, wrong: 0 } }, (o) => {
          st.stats = (o && o.fj_stats) || { right: 0, wrong: 0 };
          resolve(st.stats);
        });
      } catch (e) {
        st.stats = { right: 0, wrong: 0 };
        resolve(st.stats);
      }
    });
  }

  function extractCorrectAnswer(el) {
    const text = (el.innerText || '').replace(/\r/g, '');
    let m = text.match(ANS_RE);
    if (!m) m = text.match(/答案\s*[：:]\s*([^\n]{1,300})/);
    if (!m) return '';
    let a = String(m[1]).split(/我的答案|答案解析|解析|得分|分值/)[0].trim();
    if (/^(无|略|见解析|暂无|暂无答案)$/.test(a)) return '';
    if (a.length < 1) return '';
    return a;
  }

  async function harvestTick() {
    if (!S.harvest) return;
    if (Date.now() - st.lastHarvestAt < 12000) return;
    const els = findQuestions();
    if (!els.length) return;
    const sample = els.slice(0, 3).map((e) => e.innerText || '').join('\n');
    if (!/正确答案/.test(sample)) return;
    st.lastHarvestAt = Date.now();
    await loadBankStore();
    let n = 0;
    els.forEach((el) => {
      const q = parseQuestion(el);
      const title = String(q.text || '')
        .split(/正确答案|我的答案|答案解析/)
        .join('')
        .trim();
      if (title.length < 4) return;
      const ans = extractCorrectAnswer(el);
      if (!ans) return;
      const picks = answerToPicks(ans, q);
      if (!picks.length && q.type !== 'blank' && q.type !== 'text') return;
      const key = hashStr(q.type + '|' + norm(title));
      if (bankPut(key, { text: title, type: q.type }, ans)) n++;
    });
    if (n) log('回收正确答案 ' + n + ' 条 → 本地题库', 'warn');
  }

  async function statsTick() {
    if (Date.now() - st.lastStatsAt < 8000) return;
    const els = findQuestions();
    if (!els.length) return;
    const sample = els.slice(0, 3).map((e) => e.innerText || '').join('\n');
    if (!/我的答案/.test(sample)) return;
    st.lastStatsAt = Date.now();
    await loadStats();
    let right = 0;
    let wrong = 0;
    els.forEach((el) => {
      const t = el.innerText || '';
      const corr = t.match(ANS_RE);
      if (!corr) return;
      const mine = t.match(/我的答案\s*[：:]\s*([^\n]{0,200})/);
      const bad = el.querySelector('.cuo, [class*="cuo"], .icon-cuo, [class*="wrong"]');
      const good = el.querySelector('.dui, [class*="dui"], [class*="correct"]');
      if (bad) {
        wrong++;
        return;
      }
      if (good) {
        right++;
        return;
      }
      if (mine) {
        const c = String(corr[1]).split(/我的答案/)[0];
        if (norm(mine[1]) && norm(mine[1]) === norm(c)) right++;
        else wrong++;
      }
    });
    const counted = right + wrong;
    if (!counted) return;
    const sig = location.pathname + '|' + counted + '|' + right + '|' + wrong;
    if (st.statsSig === sig) return;
    st.statsSig = sig;
    st.stats.right = (st.stats.right || 0) + right;
    st.stats.wrong = (st.stats.wrong || 0) + wrong;
    st.stats.lastUrl = location.href.slice(0, 160);
    st.stats.t = Date.now();
    const sm = (document.body.innerText || '')
      .slice(0, 20000)
      .match(/(?:本次得分|本次成绩|得分|成绩)\s*[：:]\s*(\d+(?:\.\d+)?)/);
    if (sm) st.stats.lastScore = sm[1];
    try {
      chrome.storage.local.set({ [STATS_KEY]: st.stats });
    } catch (e) {}
    log('本页 ' + counted + ' 题：对 ' + right + ' / 错 ' + wrong + (sm ? '，得分 ' + sm[1] : ''), wrong ? 'warn' : 'info');
    if (IS_TOP) renderPanel();
  }

  /* ---------- 答案来源 ---------- */

  function getBank() {
    if (st.bank) return st.bank;
    const map = new Map();
    String(S.localBank || '')
      .split(/\r?\n/)
      .forEach((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const i = t.lastIndexOf('|');
        if (i < 1) return;
        const q = norm(t.slice(0, i));
        const a = t.slice(i + 1).trim();
        if (q && a) map.set(q, a);
      });
    st.bank = map;
    return map;
  }

  function bankLookup(q) {
    const bank = getBank();
    if (!bank.size) return null;
    const n = norm(q.text);
    if (bank.has(n)) return bank.get(n);
    for (const [k, v] of bank) {
      if (k.length >= 8 && (n.indexOf(k) >= 0 || k.indexOf(n) >= 0)) return v;
    }
    return null;
  }

  function getCache() {
    if (st.cache) return Promise.resolve(st.cache);
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ fj_answer_cache: {} }, (o) => {
          st.cache = o.fj_answer_cache || {};
          resolve(st.cache);
        });
      } catch (e) {
        st.cache = {};
        resolve(st.cache);
      }
    });
  }

  async function putCache(key, picks) {
    const c = await getCache();
    c[key] = picks;
    const keys = Object.keys(c);
    if (keys.length > 4000) {
      keys.slice(0, keys.length - 4000).forEach((k) => delete c[k]);
    }
    try {
      await new Promise((r) => chrome.storage.local.set({ fj_answer_cache: c }, r));
    } catch (e) {}
  }

  function letterToIndex(ch, q) {
    const idx = ch.toUpperCase().charCodeAt(0) - 65;
    return idx >= 0 && idx < q.options.length ? idx : -1;
  }

  function textToIndex(t, q) {
    const n = norm(t);
    if (!n) return -1;
    for (let i = 0; i < q.options.length; i++) {
      const o = norm(q.options[i].text).replace(/^[a-h][、.．]?/, '');
      if (!o) continue;
      if (o === n || o.indexOf(n) >= 0 || n.indexOf(o) >= 0) return i;
    }
    return -1;
  }

  function answerToPicks(ans, q) {
    if (ans == null) return [];
    let v = ans;
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^[A-Ha-h]{2,}$/.test(s)) {
        return Array.from(new Set(s.toUpperCase().split('').map((c) => letterToIndex(c, q)))).filter((i) => i >= 0);
      }
    }
    if (Array.isArray(v)) {
      const out = [];
      v.forEach((x) => {
        if (typeof x === 'number') {
          if (x >= 0 && x < q.options.length) out.push(x);
        } else if (typeof x === 'string') {
          const s = x.trim();
          if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            if (n >= 0 && n < q.options.length) out.push(n);
          } else if (/^[A-Ha-h]$/.test(s)) {
            const n = letterToIndex(s, q);
            if (n >= 0) out.push(n);
          } else {
            const n = textToIndex(s, q);
            if (n >= 0) out.push(n);
          }
        }
      });
      return Array.from(new Set(out)).sort((a, b) => a - b);
    }
    const s = String(v).trim();
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      return n >= 0 && n < q.options.length ? [n] : [];
    }
    if (/^[A-Ha-h]$/.test(s)) {
      const n = letterToIndex(s, q);
      return n >= 0 ? [n] : [];
    }
    const n = textToIndex(s, q);
    if (n >= 0) return [n];
    // 判断题口语答案
    if (q.type === 'judge') {
      const truthy = /^(对|正确|是|√|T|true|yes)$/i.test(s);
      const idx = q.options.findIndex((o) => {
        const t = norm(o.text);
        return truthy ? /(对|正确|是|√|^t$)/.test(t) : /(错|错误|否|×|^f$)/.test(t);
      });
      return idx >= 0 ? [idx] : [];
    }
    return [];
  }

  function normalizeApiAnswer(data, q) {
    if (!data) return null;
    let v = data;
    if (typeof data === 'object' && 'answer' in data) v = data.answer;
    else if (typeof data === 'object' && data.data && typeof data.data === 'object' && 'answer' in data.data) v = data.data.answer;
    else if (typeof data === 'object' && 'result' in data) v = data.result;

    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.text === 'string') return { picks: [], text: v.text };
      if (Array.isArray(v.index)) {
        return { picks: v.index.filter((i) => typeof i === 'number' && i >= 0 && i < q.options.length), text: '' };
      }
      if (typeof v.answer !== 'undefined') v = v.answer;
    }

    const picks = answerToPicks(v, q);
    if (!picks.length && typeof v === 'string' && (q.type === 'blank' || q.type === 'text')) {
      return { picks: [], text: v };
    }
    if (!picks.length) return null;
    return { picks, text: '' };
  }

  async function askApi(q) {
    if (!S.apiUrl) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (S.apiKey) headers['Authorization'] = 'Bearer ' + S.apiKey;
      const res = await fetch(S.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: q.text,
          type: q.type,
          options: q.options.map((o) => o.text),
          source: 'fj-cx-helper'
        }),
        signal: ctl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return normalizeApiAnswer(data, q);
    } finally {
      clearTimeout(timer);
    }
  }

  function fallbackPicks(q) {
    const n = q.options.length;
    if (!n) return [];
    if (q.type === 'multi') return q.options.map((_, i) => i);
    if (q.type === 'judge') {
      const idx = q.options.findIndex((o) => /(对|正确|是|√)/.test(o.text));
      return [idx >= 0 ? idx : 0];
    }
    if (S.fallback === 'random') return [Math.floor(Math.random() * n)];
    if (S.fallback === 'longest') {
      let best = 0;
      q.options.forEach((o, i) => {
        if (o.text.length > q.options[best].text.length) best = i;
      });
      return [best];
    }
    return [0];
  }

  async function resolveAnswer(q) {
    // 1. 本地题库
    const local = bankLookup(q);
    if (local != null) {
      const picks = answerToPicks(local, q);
      if (picks.length) return { picks, text: '', source: '本地题库' };
      if (q.type === 'blank' || q.type === 'text') return { picks: [], text: local, source: '本地题库' };
    }

    // 本地题库（自动回收 / 导入）
    await loadBankStore();
    let rec = st.bankStore[q.key];
    if (!rec) rec = st.bankStore[hashStr('|' + norm(q.text))];
    if (rec && rec.ans) {
      const picks = answerToPicks(rec.ans, q);
      if (picks.length) {
        rec.hit = (rec.hit || 0) + 1;
        saveBankStore();
        return { picks, text: '', source: '题库' };
      }
      if (q.type === 'blank' || q.type === 'text') {
        rec.hit = (rec.hit || 0) + 1;
        saveBankStore();
        return { picks: [], text: rec.ans, source: '题库' };
      }
    }

    // 2. 缓存
    const cache = await getCache();
    if (cache[q.key] && cache[q.key].length) return { picks: cache[q.key], text: '', source: '缓存' };

    // 3. 远程题库
    if (S.apiUrl) {
      try {
        const r = await askApi(q);
        if (r && (r.picks.length || r.text)) {
          if (r.picks.length) await putCache(q.key, r.picks);
          return { picks: r.picks, text: r.text, source: 'API' };
        }
      } catch (e) {
        log('题库 API 失败：' + e.message, 'warn');
      }
    }

    // 4. 兜底（可关闭，避免瞎猜拉低正确率）
    if (S.skipGuess) return { picks: [], text: '', source: '未知·已跳过' };
    return { picks: fallbackPicks(q), text: '', source: '兜底' };
  }

  /* ---------- 作答 ---------- */

  function clickOption(li) {
    if (!li) return;
    const input = li.querySelector('input');
    const label = li.querySelector('label') || li;
    try {
      label.click();
    } catch (e) {}
    if (input && !input.checked) {
      try {
        input.click();
      } catch (e) {}
    }
    if (input && !input.checked) {
      input.checked = true;
      try {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {}
    }
  }

  function fillBlanks(q, text) {
    if (!text) return;
    const list = q.blanks;
    if (!list.length) return;
    const parts = String(text).split('||').map((s) => s.trim());
    list.forEach((el, i) => {
      const v = parts[i] != null ? parts[i] : parts[0] || text;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.isContentEditable) {
        el.textContent = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  async function runWork() {
    if (st.workBusy) return;
    st.workBusy = true;
    try {
      const els = findQuestions();
      if (!els.length) return;
      const todo = els.map(parseQuestion).filter((q) => q.text && !q.el.dataset.fjAnswered);
      if (!todo.length) {
        if (S.autoSubmit && !st.submitted && els.every((e) => e.dataset.fjAnswered === '1')) submitWork();
        return;
      }
      log('检测到 ' + els.length + ' 道题，待作答 ' + todo.length);

      for (const q of todo) {
        let ans = null;
        try {
          ans = await resolveAnswer(q);
        } catch (e) {
          ans = { picks: [], text: '', source: '异常' };
        }
        if (!ans.picks.length && !ans.text) {
          q.el.dataset.fjAnswered = '2';
          log('第 ' + (els.indexOf(q.el) + 1) + ' 题 [' + q.type + '] 没答案，留空（' + ans.source + '）', 'warn');
          continue;
        }
        if (ans.picks.length) ans.picks.forEach((i) => clickOption(q.optEls[i]));
        if (ans.text) fillBlanks(q, ans.text);
        q.el.dataset.fjAnswered = '1';
        log('第 ' + (els.indexOf(q.el) + 1) + ' 题 [' + q.type + '] ' + ans.source + ' → ' + (ans.picks.join(',') || (ans.text ? '文本' : '空')));
        await sleep(220);
      }

      if (S.autoSubmit && !st.submitted && els.every((e) => e.dataset.fjAnswered === '1')) {
        await sleep(500);
        submitWork();
      }
    } catch (e) {
      log('答题异常：' + e.message, 'error');
    } finally {
      st.workBusy = false;
    }
  }

  function findSubmitBtn() {
    const sels = ['#submitBtn', '.completeBtn', 'a.jb_btn_92', 'button[onclick*="submit"]', '#answerSheet .completeBtn', '.sub_btn'];
    for (const s of sels) {
      const el = $(s);
      if (el && visible(el)) return el;
    }
    const nodes = $$('a, button, div, span').filter((el) => {
      const t = (el.innerText || '').trim();
      return visible(el) && el.children.length <= 1 && /^(提交|提交答案|交卷|提交作业)$/.test(t);
    });
    return nodes[0] || null;
  }

  async function clickConfirm() {
    await sleep(900);
    const cands = $$('a, button, div, span').filter((el) => {
      const t = (el.innerText || '').trim();
      return visible(el) && el.children.length <= 2 && /^(确定|确认|提交|是|继续)$/.test(t);
    });
    const inLayer = cands.find((el) =>
      el.closest('.layui-layer, .popup, .dialog, .mask, .ui-dialog, [class*="dialog"], [class*="layer"], [class*="popup"]')
    );
    const btn = inLayer || cands[0];
    if (btn) {
      log('点击确认：' + (btn.innerText || '').trim());
      try {
        btn.click();
      } catch (e) {}
    }
  }

  function submitWork() {
    if (st.submitted) return;
    const btn = findSubmitBtn();
    if (!btn) {
      log('没找到提交按钮，题目已填好，手动提交即可', 'warn');
      return;
    }
    st.submitted = true;
    log('提交答卷');
    try {
      btn.click();
    } catch (e) {}
    clickConfirm();
    setTimeout(statsTick, 5000);
    setTimeout(harvestTick, 7000);
  }

  function workTick() {
    if (!S.autoWork || st.workBusy) return;
    if (Date.now() - st.lastWorkAt < 2000) return;
    if (!isWorkPage()) return;
    if (!findQuestions().length) return;
    st.lastWorkAt = Date.now();
    runWork();
  }

  /* ================= 章节讨论 · AI 一句话回复 ================= */

  const REPLIED_KEY = 'fj_replied';

  function callPage(name, args) {
    try {
      // 必须 bubbles，inject.js 是在 window 上监听，document 上发的训不冒泡就到不了主世界
      document.dispatchEvent(
        new CustomEvent('fj-page-call', {
          detail: JSON.stringify({ name, args: args || [] }),
          bubbles: true,
          composed: true
        })
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadReplied() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [REPLIED_KEY]: {} }, (o) => {
          st.replied = (!chrome.runtime.lastError && o && o[REPLIED_KEY]) || {};
          resolve();
        });
      } catch (e) {
        st.replied = {};
        resolve();
      }
    });
  }

  function saveReplied() {
    try {
      chrome.storage.local.set({ [REPLIED_KEY]: st.replied || {} });
    } catch (e) {}
  }

  async function aiOne(topic, replies, maxLen, avoid) {
    const cfg = {
      mode: S.aiMode || 'bridge',
      url: S.aiUrl || 'http://127.0.0.1:17310/summarize',
      base: S.aiBase || '',
      key: S.aiKey || '',
      model: S.aiModel || ''
    };
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'fj-ai',
        cfg,
        topic,
        replies,
        maxLen,
        avoid: avoid || '',
        prompt: S.aiPrompt || ''
      });
      if (!res || !res.ok) {
        log('AI 没给答复：' + ((res && res.error) || '无响应，检查 AI 桥是否开着'), 'warn');
        return '';
      }
      return res.text || '';
    } catch (e) {
      log('AI 调用异常：' + String(e), 'warn');
      return '';
    }
  }

  function discussBox() {
    return document.getElementById('content2');
  }

  // —— 讨论入口 ——
  // 站里有两个「讨论」：右边目录旁边的「学习讨论区」，和教师按章节发布的任务点讨论。
  // 我们要的是后者，所以优先在章节内容 / 课程导航里找「讨论」任务点，
  // 找不到就直说，不再手贱去点学习讨论区（除非用户自己打开 discussFallbackTab）。

  const ENTRY_BAD_TXT = /^(学习讨论区|讨论区|讨论|更多讨论|我的讨论|全部讨论)$/;

  function entryText(el) {
    return String((el && (el.innerText || el.textContent || el.title || el.getAttribute('title') || '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function entryClickable(el) {
    if (!el || !visible(el)) return false;
    if (el.closest('#fj-cx-panel') || el.closest('#fj-draft')) return false;
    const t = entryText(el);
    if (!t || t.length > 40) return false;
    return true;
  }

  // 候选：章节里的任务点、课程导航里的「讨论」、带 discuss/topic 的链接
  function teacherDiscussEntries() {
    const out = [];
    const seen = new Set();
    const push = (el, why) => {
      if (!entryClickable(el) || seen.has(el)) return;
      seen.add(el);
      out.push({ el, why: why, text: entryText(el).slice(0, 30) });
    };

    // 1) 任务点 / 章节条目里名字带「讨论」
    $$('.chapter_item, .chapterText, .chapterItem, .taskPoint, .point, li, .catalog_item').forEach((el) => {
      if (/讨论/.test(entryText(el)) && entryText(el).length <= 30) push(el, '章节任务点');
    });

    // 2) 直接带 discuss / topic 的链接或 onclick
    $$('a[href*="discuss"], a[href*="topic"], a[href*="bbs"], [onclick*="discuss"], [onclick*="Discuss"]').forEach((el) => {
      push(el, '链接');
    });

    // 3) 文本里同时出现「教师 / 老师」和「讨论」的块
    $$('span, div, p, a, b, strong').forEach((el) => {
      const t = entryText(el);
      if (t.length <= 24 && /讨论/.test(t) && /教师|老师/.test(t)) push(el, '带「教师」字样');
    });

    return out;
  }

  function teacherDiscussEntry() {
    if (S.discussEntry) {
      const el = $(S.discussEntry);
      if (el) return { el, why: '自定义选择器', text: entryText(el).slice(0, 30) };
    }
    const list = teacherDiscussEntries();
    // 「章节任务点」比裸链接可靠，优先
    const rank = { 章节任务点: 3, '带「教师」字样': 2, 链接: 1, 自定义选择器: 4 };
    list.sort((a, b) => (rank[b.why] || 0) - (rank[a.why] || 0));
    return list[0] || null;
  }

  async function enterTeacherDiscuss() {
    if ($$('#content2 .itemDiscuss, #content2 textarea[id^="discuss"]').length) {
      return { ok: true, how: '已经在讨论里' };
    }
    const entry = teacherDiscussEntry();
    if (!entry) {
      log('没找到教师发布的讨论入口（章节任务点 / 讨论链接都没匹配上），先不去点学习讨论区', 'warn');
      return { ok: false, why: 'no-entry' };
    }
    log('从「' + entry.text + '」（' + entry.why + '）进入教师发布的讨论');
    clickEl(entry.el);
    await sleep(1800);
    if ($$('#content2 textarea[id^="discuss"]').length || $$('#content2 .itemDiscuss').length) {
      return { ok: true, how: entry.why, text: entry.text };
    }
    // 有些入口是跳新页面的，等它加载
    if (location.href.indexOf('discuss') >= 0 || location.href.indexOf('topic') >= 0 || location.href.indexOf('/bbs') >= 0) {
      return { ok: true, how: entry.why + '（跳到讨论页）', text: entry.text };
    }
    const cues = $$('.itemDiscuss, [class*="topic"], [class*="discuss"], [class*="replay"]');
    if (cues.length) {
      log('点进去了，这页不像右栏讨论，交给通用讨论逻辑处理');
      return { ok: true, how: entry.why + '（通用页面）', text: entry.text };
    }
    log('点了「' + entry.text + '」但没看到讨论内容，可能没加载出来', 'warn');
    return { ok: false, why: 'clicked-but-empty' };
  }

  async function ensureDiscussLoaded() {
    if ($$('#content2 .itemDiscuss, #content2 textarea[id^="discuss"]').length) return true;

    const r = await enterTeacherDiscuss();
    if (r.ok && ($$('#content2 textarea[id^="discuss"]').length || $$('#content2 .itemDiscuss').length)) return true;

    // 教师讨论不是右栏那一挂的：交给通用讨论页逻辑
    if (r.ok) return false;

    // 用户明确要求「找不到也别退回学习讨论区」
    if (!S.discussFallbackTab) return false;

    log('按设置退回学习讨论区', 'warn');
    const tab = document.getElementById('tit2');
    if (tab) {
      tab.click();
      await sleep(1400);
    }
    if ($$('#content2 .itemDiscuss').length) return true;
    callPage('changePan', ['2']);
    callPage('getChapterRightDiscuss', []);
    await sleep(2600);
    if (!$$('#content2 textarea[id^="discuss"]').length) {
      const triggers = $$('#content2 .itemDiscuss [onclick*="replay("]').slice(0, 5);
      triggers.forEach((t) => {
        try {
          t.click();
        } catch (e) {}
      });
      if (triggers.length) await sleep(1400);
    }
    return !!$$('#content2 textarea[id^="discuss"]').length;
  }

  function topicTitleOf(item) {
    if (!item) return '';
    const cand =
      item.querySelector('.topicTitle, .discussTitle, .itemDiscuss_title, .title, h3, .name') || null;
    if (cand && visible(cand)) return String(cand.innerText || '').trim();
    return '';
  }

  function repliesOf(id) {
    const out = [];
    const box = document.getElementById('replaylist' + id);
    if (!box) return out;
    const nodes = box.querySelectorAll('.replyItem, .itemReply, li, .replayList_item, p');
    if (nodes.length) {
      Array.from(nodes).forEach((n) => {
        const t = String(n.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length > 4) out.push(t);
      });
    } else {
      const t = String(box.innerText || '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out.slice(0, 8);
  }

  function collectDiscussTasks() {
    const box = discussBox();
    if (!box) return [];
    const out = [];
    const seen = new Set();
    $$('#content2 textarea[id^="discuss"]', box.parentElement || document).forEach((ta) => {
      const m = /^discuss(\d+)$/.exec(ta.id || '');
      if (!m) return;
      const id = m[1];
      if (seen.has(id)) return;
      seen.add(id);

      const item = ta.closest('.itemDiscuss') || ta.closest('.replaytextarea') || ta.parentElement;
      const title = topicTitleOf(item);
      const full = String((item && item.innerText) || '').replace(/\s+/g, ' ').trim();
      const replies = repliesOf(id);

      let topic = title;
      if (!topic) {
        topic = full
          .replace(/回复|点赞|举报|展开|收起|全部回复|请输入|发布|取消/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 300);
      }
      if (!topic) return;

      let count = 0;
      const cntEl = document.getElementById('replycount' + id);
      if (cntEl) count = Number(String(cntEl.innerText || cntEl.value || '0').replace(/\D/g, '')) || 0;
      if (!count && replies.length) count = replies.length;

      out.push({ id, topic, replies, count, textarea: ta });
    });
    return out;
  }

  /* ================= 发送前确认 + 一键换一句 ================= */

  function draftCard(topic, initial, onRegen, note) {
    return new Promise((resolve) => {
      const old = document.getElementById('fj-draft');
      if (old) old.remove();
      const mk = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
      };
      const wrap = mk('div');
      wrap.id = 'fj-draft';
      const head = mk('div', 'fj-d-head', 'AI 拟好了一句，发吗？');
      const sub = mk('div', 'fj-d-sub', topic ? '话题：' + String(topic).slice(0, 60) : '');
      const ta = mk('textarea', 'fj-d-text');
      ta.value = String(initial || '');
      const row = mk('div', 'fj-d-row');
      const bSend = mk('button', 'fj-d-btn fj-d-send', '发送');
      const bRegen = mk('button', 'fj-d-btn fj-d-regen', '换一句');
      const bCancel = mk('button', 'fj-d-btn fj-d-cancel', '不发');
      const tip = mk('span', 'fj-d-tip', '');
      row.appendChild(bSend);
      row.appendChild(bRegen);
      row.appendChild(bCancel);
      row.appendChild(tip);
      wrap.appendChild(head);
      wrap.appendChild(sub);
      if (note) wrap.appendChild(mk('div', 'fj-d-note', note));
      wrap.appendChild(ta);
      wrap.appendChild(row);

      let busy = false;
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          done({ ok: false });
        }
      };
      const done = (v) => {
        try {
          wrap.remove();
        } catch (e) {}
        try {
          document.removeEventListener('keydown', onKey, true);
        } catch (e) {}
        resolve(v);
      };
      bSend.addEventListener('click', () => {
        const t = String(ta.value || '').replace(/\s+/g, ' ').trim();
        if (!t) {
          tip.textContent = '空的，写两句再发';
          return;
        }
        done({ ok: true, text: t.slice(0, 300) });
      });
      bCancel.addEventListener('click', () => done({ ok: false }));
      bRegen.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        tip.textContent = '正在换一句…';
        try {
          const next = await onRegen(String(ta.value || '').trim());
          if (next) {
            ta.value = next;
            tip.textContent = '换好了，不满意再点';
          } else {
            tip.textContent = '没换出来，原句还留着';
          }
        } catch (e) {
          tip.textContent = '换失败：' + String(e);
        }
        busy = false;
      });
      document.addEventListener('keydown', onKey, true);
      (document.body || document.documentElement).appendChild(wrap);
      setTimeout(() => {
        try {
          ta.focus();
        } catch (e) {}
      }, 80);
    });
  }

  // 回复完把这个话题页关掉（交给 background 调 chrome.tabs.remove）
  async function closeThisTab(reason) {
    if (!S.closeAfterReply) return;
    log('回复完了，' + (reason || '') + '1.5 秒后关掉这个标签页');
    await sleep(1500);
    try {
      await chrome.runtime.sendMessage({ type: 'fj-close-tab' });
    } catch (e) {}
  }

  // 统一入口：需要确认就弹卡片让人看着改，不需要就直接返回原文
  async function askSend(topic, text, regen, note) {
    if (!S.confirmSend) return { ok: true, text };
    log('等你确认：这句话要不要发？', 'warn');
    return await draftCard(topic, text, regen, note);
  }

  async function replyOne(task, text) {
    const ta = task.textarea && task.textarea.isConnected
      ? task.textarea
      : document.getElementById('discuss' + task.id);
    if (!ta) return false;
    // 页面自己的 addDiscussReply 会先清空 textarea，所以清空不等于成功；
    // 用「回复数变化 / 回复列表变化」兜底判断。
    const cntEl = document.getElementById('replycount' + task.id);
    const before = {
      cnt: cntEl ? String(cntEl.innerText || '') : '',
      list: String((document.getElementById('replaylist' + task.id) || {}).innerHTML || '').length
    };
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
    if (!callPage('addDiscussReply', [task.id, String(task.count || 0)])) return false;
    await sleep(2000);
    const na = document.getElementById('discuss' + task.id);
    const nc = document.getElementById('replycount' + task.id);
    const nl = String((document.getElementById('replaylist' + task.id) || {}).innerHTML || '').length;
    const cleared = !!(na && na.value === '');
    const countChanged = !!(nc && String(nc.innerText || '') !== before.cnt);
    const listChanged = nl !== before.list;
    return cleared || countChanged || listChanged;
  }

  async function discussTick() {
    if (!IS_TOP || !S.discussAuto || st.discussBusy) return;
    if (isBbsPage()) return;
    if (!st.discussForce && Date.now() - st.lastDiscussAt < 8000) return;
    st.discussBusy = true;
    st.lastDiscussAt = Date.now();
    st.discussForce = false;
    try {
      if (!st.replied) await loadReplied();
      if (!discussBox() || !$$('#content2 textarea[id^="discuss"]').length) {
        const entered = await ensureDiscussLoaded();
        if (!discussBox()) {
          // 教师发布的话题常常是独立页，不在右边那一栏里
          if (bbsEditors().length) {
            st.discussBusy = false;
            await bbsTick();
            return;
          }
          log(entered ? '进了讨论页但没找到回复框' : '没进到讨论：没找到教师发布的讨论入口', 'warn');
          return;
        }
      }
      const tasks = collectDiscussTasks();
      if (!tasks.length) {
        log('没找到可回复的讨论');
        return;
      }
      const pending = tasks.filter((t) => !st.replied[t.id]);
      if (!pending.length) {
        log('讨论都在已回复列表里，跳过');
        return;
      }
      const max = Math.min(Math.max(Number(S.discussMax) || 3, 1), 20);
      const maxLen = Math.min(Math.max(Number(S.discussLen) || 60, 15), 200);
      let done = 0;
      for (const t of pending) {
        if (done >= max) break;
        log('正在总结讨论：' + t.topic.slice(0, 40));
        const text = await aiOne(t.topic, t.replies, maxLen);
        if (!text) break;
        const ask = await askSend(t.topic, text, (prev) => aiOne(t.topic, t.replies, maxLen, prev));
        if (!ask.ok || !ask.text) {
          log('这条你选了不发，跳过[' + t.id + ']');
          break;
        }
        if (await replyOne(t, ask.text)) {
          st.replied[t.id] = { t: Date.now(), text: ask.text };
          saveReplied();
          log('已回复讨论[' + t.id + ']：' + ask.text, 'warn');
          done++;
          await sleep(4000 + Math.floor(Math.random() * 4000));
        } else {
          log('回复失败[' + t.id + ']，可能是页面结构变了', 'warn');
          break;
        }
      }
      if (done) log('本轮回复了 ' + done + ' 条讨论');
    } finally {
      st.discussBusy = false;
    }
  }

  /* ================= 通用讨论页（groupweb / bbs / topic 单页） ================= */

  const ED_SEL =
    'textarea, [contenteditable="true"], .ql-editor, .ProseMirror, .ck-content, .vditor-reset, .wangEditor-txt';
  const SUBMIT_TXT = /^(发表|发布|回复|发送|提交|评论|确定|发帖|回帖)/;
  const SUBMIT_NOT = /(取消|删除|举报|取消回复|赞|收藏)/;

  function isBbsPage() {
    const s = (location.hostname || '') + (location.pathname || '');
    return /groupweb|bbs|\/topic\/|discuss/i.test(s) && !document.getElementById('content2');
  }

  function bbsEditors() {
    return $$(ED_SEL).filter(
      (el) =>
        visible(el) &&
        !el.closest('#fj-cx-panel') &&
        !el.closest('#fj-draft') &&
        !el.disabled &&
        !el.readOnly
    );
  }

  function bbsTopic() {
    const BAD = /^(话题详情|详情|首页|讨论|讨论区|话题|全部|课程|回复|置顶|返回|更多|最新|热门)$/;
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const use = (t) => {
      const s = clean(t);
      if (s.length < 6 || s.length > 200) return '';
      if (BAD.test(s)) return '';
      if (/^(第)?\d+楼$/.test(s)) return '';
      return s;
    };
    // 1) 明确的话题标题类名
    for (const s of ['.topic-title', '.detail-title', '.bbs-title', '.topicName', '.subject', '.mainTitle']) {
      const t = use($(s) && $(s).innerText);
      if (t) return t;
    }
    // 2) 标题里挑最长的一个（面包屑「话题详情」最短，会被挤掉）
    const pool = [];
    $$('h1, h2, h3, [class*="title"], [class*="Title"], [class*="subject"], [class*="Subject"]').forEach((el) => {
      if (el.closest('#fj-cx-panel')) return;
      if (!visible(el)) return;
      const t = use(el.innerText);
      if (t) pool.push(t);
    });
    pool.sort((a, b) => b.length - a.length);
    if (pool.length) return pool[0];
    // 3) 最后用页面标题
    return use(
      String(document.title || '')
        .replace(/\s*[-_|]\s*(超星|学习通|课程|讨论).*$/, '')
        .replace(/\s+/g, ' ')
    );
  }

  function bbsReplies() {
    const out = [];
    const pick = (sel) => {
      $$(sel).forEach((n) => {
        const t = String(n.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length > 5 && t.length < 400) out.push(t.slice(0, 300));
      });
    };
    pick('.reply-item, .item-reply, .comment-item, .replayItem, [class*="replyItem"], [class*="reply-item"]');
    if (!out.length) pick('[class*="comment"] li, [class*="replay"] p, .content p');
    return Array.from(new Set(out)).slice(0, 8);
  }

  function bbsSubmit(editor) {
    const scopes = [
      editor.closest('form'),
      editor.closest('[class*="editor"], [class*="reply"], [class*="comment"], [class*="publish"]'),
      editor.parentElement && editor.parentElement.parentElement,
      document
    ].filter(Boolean);
    for (const sc of scopes) {
      const btns = $$('button, a, span, div, input[type="button"], input[type="submit"]', sc)
        .filter((b) => visible(b) && !b.closest('#fj-cx-panel') && !b.disabled)
        .filter((b) => {
          const t = String(b.innerText || b.value || '').replace(/\s+/g, '');
          return t.length > 0 && t.length <= 8 && SUBMIT_TXT.test(t) && !SUBMIT_NOT.test(t);
        });
      if (btns.length) return btns[0];
    }
    return null;
  }

  function setEditor(editor, text) {
    try {
      editor.focus();
      if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
        editor.value = text;
      } else {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        let ok = false;
        try {
          ok = document.execCommand('insertText', false, text);
        } catch (e) {}
        if (!ok) editor.textContent = text;
      }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function bbsTick() {
    if (!IS_TOP || !S.discussAuto || st.discussBusy) return;
    if (!isBbsPage()) return;
    if (!st.discussForce && Date.now() - st.lastDiscussAt < 10000) return;
    st.discussBusy = true;
    st.lastDiscussAt = Date.now();
    st.discussForce = false;
    try {
      if (!st.replied) await loadReplied();
      const topic = bbsTopic();
      const key = 'bbs:' + hashStr(location.pathname + '|' + topic);
      if (st.replied[key]) {
        log('这个话题已经回过了，跳过');
        return;
      }
      let eds = bbsEditors();
      if (!eds.length) {
        // 有的页面要先把「回复」点开来才出现输入框
        const opener = $$('button, a, span, div')
          .filter((b) => visible(b) && !b.closest('#fj-cx-panel'))
          .filter((b) => /^(回复|写回复|发表评论|参与讨论|我要回复|发表回复)$/.test(String(b.innerText || '').replace(/\s+/g, '')))
          .slice(0, 1)[0];
        if (opener) {
          opener.click();
          await sleep(1000);
          eds = bbsEditors();
        }
      }
      if (!eds.length) {
        log('这一页没找到回复输入框（编辑器在 iframe 里的话点“诊断页面”发我日志）', 'warn');
        return;
      }
      const ed = eds[0];
      // 这页上如果已经有扩展以前发过的那条，先记下来，等确认之后再删掉它
      const prev = oldAIReply();
      if (prev) log('页面上已经有一条本扩展发过的旧回复，发送时会先删掉它');
      const hidePrev = prev ? normLike(prev.text) : '';
      // 那条老回复不能当成「同学的发言」喂给模型，不然它会照着老口气写
      const replies = bbsReplies().filter((t) => !hidePrev || normLike(t).indexOf(hidePrev) < 0);
      const maxLen = Math.min(Math.max(Number(S.discussLen) || 60, 15), 200);
      log('正在总结话题：' + topic.slice(0, 40) + '（已有 ' + replies.length + ' 条发言）');
      const text = await aiOne(topic, replies, maxLen);
      if (!text) return;
      const ask = await askSend(
        topic,
        text,
        (p) => aiOne(topic, replies, maxLen, p),
        prev ? '这页上有一条旧的回复，点「发送」会先把它删掉再发这句，保证只留一条' : ''
      );
      if (!ask.ok || !ask.text) {
        log('这句你选了不发，这个话题先记下，免得我老来烦你');
        st.replied[key] = { t: Date.now(), text: '', skipped: true };
        saveReplied();
        return;
      }
      if (prev) {
        if (await editOldReply(prev.node, ask.text)) {
          st.replied[key] = { t: Date.now(), text: ask.text };
          saveReplied();
          log('已把那条旧回复改成新的：' + ask.text, 'warn');
          await closeThisTab('这条话题的回复已经更新成新的说法，');
          return;
        }
        const gone = await deleteReply(prev.node, prev.btn);
        if (!gone) {
          log('那条旧回复删不掉（没认出确认按钮），这次先不发，免得变成两条', 'warn');
          return;
        }
      }
      if (!setEditor(ed, ask.text)) {
        log('填不进输入框，放弃这个话题', 'warn');
        return;
      }
      await sleep(500);
      const btn = bbsSubmit(ed);
      if (!btn) {
        log('文字已经填好了，但没认出发表按钮，你手动点一下，或把页面结构发我', 'warn');
        return;
      }
      // 只点一次：重复点会把同一句发两楼
      btn.click();
      await sleep(2200);
      const left = String(ed.value != null ? ed.value : ed.innerText || '').trim();
      const toast = $$('.layui-layer-msg, .toast, [class*="success"], [class*="Success"]').some(
        (n) => visible(n) && /(成功|已发布|已回复|发表成功)/.test(String(n.innerText || ''))
      );
      if (!left || toast) {
        st.replied[key] = { t: Date.now(), text: ask.text };
        saveReplied();
        log('已回复话题：' + ask.text, 'warn');
        await closeThisTab('这个话题已经回过了，');
      } else {
        // 页面没给任何确认（有的站点不发 toast 也不清空），但按钮确实点了：
        // 仍然记下，避免下一轮重复发同一句话
        st.replied[key] = { t: Date.now(), text: ask.text };
        saveReplied();
        log('已回复话题（未确认，页面没给成功提示）：' + ask.text, 'warn');
        await closeThisTab('这个话题已经点过发表了，');
      }
    } finally {
      st.discussBusy = false;
    }
  }

  /* ================= 统一回复：旧的换成新的，只留一条 ================= */

  const OLD_AI_HINT = /(我觉得|我认为|我个人|说实话|真能|白干|挖坑|绝了|离谱|寄了|狠狠|爆改|哈哈哈)/;
  const DEL_TXT = /^(删除|删掉|移除|删除回复)$/;

  function bbsReplyNodes() {
    const sels = [
      '.reply-item, .item-reply, .comment-item, .replayItem, [class*="replyItem"], [class*="reply-item"]',
      '[class*="comment"] li, [class*="replay"] p'
    ];
    for (const sel of sels) {
      const nodes = $$(sel).filter((n) => {
        const t = String(n.innerText || '').trim();
        return visible(n) && t.length > 4 && t.length < 400;
      });
      if (nodes.length) return nodes;
    }
    return [];
  }

  function replyDeleteBtn(node) {
    const all = $$('a, button, span, div', node).filter((b) => b.children.length === 0);
    const hit = (list) =>
      list
        .filter((b) => DEL_TXT.test(String(b.innerText || '').replace(/\s+/g, '')))
        .slice(0, 1)[0] || null;
    // 先找看得见的，再退化到藏着的（有的站要 hover 才显示「删除」，但节点是在的）
    return (
      hit(all.filter((b) => visible(b))) || hit(all) || null
    );
  }



  function ourRecordedTexts() {
    const out = [];
    const m = st.replied || {};
    Object.keys(m).forEach((k) => {
      const v = m[k] && m[k].text;
      if (v && String(v).length > 8) out.push(String(v));
    });
    return out;
  }

  function normLike(s) {
    return String(s || '').replace(/[\s，。！？、,.!?：:；;（）()【】'"“”]/g, '');
  }

  // 只认「带删除按钮」的楼层：学习通只给自己的回复渲染「删除」，
  // 所以别人的楼层永远不会被这里动到。
  function oldAIReply() {
    const recs = ourRecordedTexts().map(normLike);
    const nodes = bbsReplyNodes();
    for (const node of nodes) {
      const btn = replyDeleteBtn(node);
      if (!btn) continue;
      const t = String(node.innerText || '').replace(/\s+/g, ' ');
      const nt = normLike(t);
      const hitRec = recs.some((r) => r && nt.indexOf(r) >= 0);
      const hitStyle = OLD_AI_HINT.test(t);
      if (hitRec || hitStyle) return { node, btn, text: t.slice(0, 200) };
    }
    return null;
  }

  async function deleteReply(node, btn) {
    log('先删掉这页上那条旧的 AI 回复：' + String(node.innerText || '').replace(/\s+/g, ' ').slice(0, 40));
    try {
      btn.click();
    } catch (e) {
      return false;
    }
    await sleep(700);
    const layerBtn =
      $$('a, button, div, span')
        .filter((el) => visible(el) && el.children.length <= 2)
        .filter((el) => /^(确定|确认|是|删除|确定删除)$/.test(String(el.innerText || '').trim()))
        .filter((el) =>
          el.closest('.layui-layer, [class*="layer"], .dialog, [class*="dialog"], [class*="popup"], [class*="mask"]')
        )
        .slice(0, 1)[0] || null;
    if (layerBtn) {
      log('点击确认：' + String(layerBtn.innerText || '').trim());
      try {
        layerBtn.click();
      } catch (e) {}
    }
    await sleep(1500);
    return !node.isConnected || !visible(node);
  }

  const EDIT_TXT = /^(编辑|修改|重新编辑)$/;

  function replyEditBtn(node) {
    return (
      $$('a, button, span, div', node)
        .filter((b) => b.children.length === 0)
        .filter((b) => EDIT_TXT.test(String(b.innerText || '').replace(/\s+/g, '')))
        .slice(0, 1)[0] || null
    );
  }

  // 优先「就地改」：平台有编辑入口时，把新的句子写回旧楼层，
  // 这样它在页面上的位置和楼层都不变，只是内容换成新的。
  async function editOldReply(node, text) {
    const btn = replyEditBtn(node);
    if (!btn) return false;
    log('这条旧回复能编辑，直接把它改成新的说法（原位替换）');
    try {
      btn.click();
    } catch (e) {
      return false;
    }
    await sleep(900);
    const layer = node.closest('[class*="layer"], [class*="dialog"], [class*="popup"], [class*="modal"]');
    const scope = layer || node;
    const ed =
      $$('textarea, [contenteditable="true"]', scope).filter((el) => visible(el) && !el.closest('#fj-draft'))[0] || null;
    if (!ed) return false;
    if (!setEditor(ed, text)) return false;
    await sleep(400);
    const save =
      $$('a, button, span, div', scope)
        .filter((b) => visible(b) && b.children.length <= 2)
        .filter((b) => /^(保存|提交|确定|更新|完成|发布)$/.test(String(b.innerText || '').replace(/\s+/g, '')))
        .slice(0, 1)[0] || null;
    if (!save) return false;
    try {
      save.click();
    } catch (e) {
      return false;
    }
    await sleep(1600);
    return true;
  }

  async function purgeOld() {
    let n = 0;
    for (let i = 0; i < 6; i++) {
      const old = oldAIReply();
      if (!old) break;
      const gone = await deleteReply(old.node, old.btn);
      if (!gone) {
        log('有一条旧回复删不掉（没认到确认按钮），停下', 'warn');
        break;
      }
      n++;
      await sleep(900);
    }
    log(n ? '清掉了 ' + n + ' 条旧回复，页面上只剩新写的了' : '这页没找到扩展发过的旧回复');
  }

  /* ================= 翻页 / 滑动课件 ================= */
  // 学习通的 PPT / 文档 / 图片课件是一页一页翻的：右侧有「下一页」按钮的最省事，
  // 但有的只吃滚轮、有的要上下滑（滑动课件）、有的是 swiper 组件。
  // 这里按「按钮 → swiper → 键盘 → 滚轮 → 滑动 → 滚动条」从稳到野排队，
  // 用「页码 / 滚动位置 / 当前图」判断有没有翻过去，翻不动就换下一招。

  const SLIDE_NEXT_SEL = [
    '.swiper-button-next',
    '.next-btn',
    '#nextBtn',
    '#next',
    '.btn-next',
    '.page-next',
    '[class*="next"][class*="btn"]',
    '[class*="btn"][class*="next"]',
    '[title*="下一"]',
    '[aria-label*="下一"]',
    'a[onclick*="next"]',
    'a[onclick*="Next"]',
    '.ans-next',
    '.ans-module-next',
    '#ansNext',
    '.slide-next',
    '#slideNext',
    '.btnNext',
    '.next-page',
    '#prevNextFocusNext',
    '[class*="nextPage"]',
    '[class*="next-page"]',
    '[class*="nextSlide"]'
  ].join(',');

  const NEXT_TXT = /^(下一页|下一张|下一节|下一个|下一页>|继续|next|›|»|＞|>)$/i;
  const SLIDE_DONE_TXT = /(已看完|已经学完|课件已学完|学习完成|任务点已完成|已完成学习)/;

  function slideText(el) {
    return String((el && (el.innerText || el.textContent || el.value || el.title || '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 页码：1/12、3 / 12 这种，或者 aria-valuenow="3"
  function slideIndicator() {
    const cands = $$('span, i, em, b, div, p');
    for (let k = 0; k < cands.length; k++) {
      const el = cands[k];
      if (!visible(el)) continue;
      if (el.closest('#fj-cx-panel') || el.closest('#fj-draft')) continue;
      const t = slideText(el);
      if (t.length > 12) continue;
      const m = /^(\d{1,4})\s*[/／]\s*(\d{1,4})$/.exec(t);
      if (m) return { cur: Number(m[1]), total: Number(m[2]), text: t };
    }
    const aria = $('[aria-valuenow][aria-valuemax]');
    if (aria && visible(aria)) {
      const cur = Number(aria.getAttribute('aria-valuenow'));
      const total = Number(aria.getAttribute('aria-valuemax'));
      if (cur && total) return { cur, total, text: cur + '/' + total };
    }
    return null;
  }

  function slideRoot() {
    const prefer = [
      '#panView',
      '#docContainer',
      '.doc-container',
      '#contentDiv',
      '.ppt-container',
      '#fullScreenContainer',
      '#pptDiv',
      '.pptDiv',
      '.ans-module-preview',
      '.ans-module-content',
      '#slideContent',
      '.slide-content',
      '.slide-container'
    ];
    for (let k = 0; k < prefer.length; k++) {
      const el = $(prefer[k]);
      if (el && visible(el) && el.scrollHeight > el.clientHeight + 40) return el;
    }
    let best = null;
    const all = $$('div, section, article');
    for (let k = 0; k < all.length; k++) {
      const el = all[k];
      if (!visible(el)) continue;
      if (el.closest('#fj-cx-panel') || el.closest('#fj-draft')) continue;
      if (el.scrollHeight <= el.clientHeight + 80) continue;
      if (el.clientHeight < 200) continue;
      if (!best || el.scrollHeight > best.scrollHeight) best = el;
    }
    return best;
  }

  function slideNextBtn() {
    const direct = $(SLIDE_NEXT_SEL);
    if (direct && visible(direct) && !isDisabled(direct)) return direct;
    const all = $$('button, a, span, div, i, input[type="button"]');
    for (let k = 0; k < all.length; k++) {
      const el = all[k];
      if (!visible(el) || isDisabled(el)) continue;
      if (el.closest('#fj-cx-panel') || el.closest('#fj-draft')) continue;
      const t = slideText(el);
      if (t && t.length <= 10 && NEXT_TXT.test(t)) return el;
    }
    return null;
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    const cls = String(el.className || '');
    if (/disabled|forbid|ban\b/i.test(cls)) return true;
    if (el.getAttribute && (el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') != null)) {
      return true;
    }
    return false;
  }

  function slideDoneText() {
    const all = $$('span, div, p, i, em');
    for (let k = 0; k < all.length; k++) {
      const el = all[k];
      if (!visible(el)) continue;
      const t = slideText(el);
      if (t.length <= 24 && SLIDE_DONE_TXT.test(t)) return t;
    }
    return '';
  }

  function slideSwiper() {
    const box = $('.swiper, .swiper-container, .swiper-wrapper');
    if (!box) return null;
    let el = box;
    for (let k = 0; k < 4 && el; k++) {
      if (el.swiper && typeof el.swiper.slideNext === 'function') return el.swiper;
      el = el.parentElement;
    }
    const wrap = $('.swiper-wrapper');
    if (wrap) {
      const cur = Number(wrap.getAttribute('data-cur') || 0);
      return {
        slideNext: function () {
          wrap.setAttribute('data-cur', String(cur + 1));
          wrap.style.transform = 'translate3d(0,' + -100 * (cur + 1) + '%,0)';
        }
      };
    }
    return null;
  }

  function slideSig() {
    const ind = slideIndicator();
    if (ind) return 'p' + ind.cur + '/' + ind.total;
    let sig = '';
    const sw = $('.swiper-wrapper');
    if (sw) {
      const tr = String(sw.style.transform || '');
      if (tr) sig = 'sw' + tr;
    }
    const root = slideRoot();
    if (!sig && root) sig = 's' + Math.round(root.scrollTop / 50);
    // 纯图片课件：页面未必会滚，但图会换，所以把主图也编进指纹
    const imgs = $$('img').filter(function (i) {
      return visible(i) && (i.clientWidth || 0) > 200;
    });
    if (imgs.length) {
      imgs.sort(function (x, y) {
        return (y.clientWidth || 0) * (y.clientHeight || 0) - (x.clientWidth || 0) * (x.clientHeight || 0);
      });
      const src = String(imgs[0].src || imgs[0].getAttribute('src') || '');
      sig = (sig ? sig + '|' : '') + 'i' + src.slice(-40);
    }
    return sig;
  }

  function slideFireKey() {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    const keys = ['ArrowRight', 'PageDown', 'ArrowDown'];
    keys.forEach(function (key) {
      try {
        const ev = new KeyboardEvent('keydown', {
          key: key,
          code: key,
          keyCode: key === 'ArrowRight' ? 39 : key === 'PageDown' ? 34 : 40,
          which: key === 'ArrowRight' ? 39 : key === 'PageDown' ? 34 : 40,
          bubbles: true,
          cancelable: true
        });
        target.dispatchEvent(ev);
        document.dispatchEvent(ev);
      } catch (e) {}
    });
    return true;
  }

  function slideFireWheel(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    try {
      el.dispatchEvent(
        new WheelEvent('wheel', { deltaY: Math.max(400, r.height * 0.8), deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true })
      );
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // 滑动课件：从下往上拖一下（很多竖屏课件只认这个）
  function slideFireSwipe(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y0 = r.top + r.height * 0.75;
    const y1 = r.top + r.height * 0.2;
    try {
      const mk = function (type, y) {
        const ev = new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true
        });
        el.dispatchEvent(ev);
      };
      mk('pointerdown', y0);
      mk('pointermove', (y0 + y1) / 2);
      mk('pointermove', y1);
      mk('pointerup', y1);
      try {
        const t = function (type, y) {
          const ev = new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }],
            changedTouches: [{ identifier: 1, clientX: x, clientY: y }]
          });
          el.dispatchEvent(ev);
        };
        t('touchstart', y0);
        t('touchmove', y1);
        t('touchend', y1);
      } catch (e2) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function slideScroll(el, ratio) {
    if (!el) return false;
    const step = Math.max(200, el.clientHeight * (ratio || 0.9));
    el.scrollTop = el.scrollTop + step;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
  }

  function slideAttempt(n) {
    const btn = slideNextBtn();
    const root = slideRoot();
    const step = n % 6;
    if (step === 0 && btn) {
      clickEl(btn);
      return '点了「' + slideText(btn).slice(0, 8) + '」';
    }
    if (step === 1) {
      const sw = slideSwiper();
      if (sw) {
        try {
          sw.slideNext();
          return 'swiper 下一张';
        } catch (e) {}
      }
    }
    if (step === 2) {
      slideFireKey();
      return '发了方向键';
    }
    if (step === 3) {
      if (slideFireWheel(root || document.body)) return '滚了一下';
      return '';
    }
    if (step === 4) {
      if (slideFireSwipe(root || document.body)) return '滑了一下';
      return '';
    }
    if (step === 5) {
      if (slideScroll(root, 0.9)) return '把课件滚下去一屏';
      return '';
    }
    // 兜底：有按钮就点按钮
    if (btn) {
      clickEl(btn);
      return '点了「' + slideText(btn).slice(0, 8) + '」';
    }
    return '';
  }

  function clickEl(el) {
    try {
      el.click();
    } catch (e) {
      ['mousedown', 'mouseup', 'click'].forEach(function (t) {
        try {
          el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
        } catch (e2) {}
      });
    }
  }

  // 课件页判定：返回空串=是课件页，返回别的=不是，顺便把原因写出来给日志用
  function slideWhy() {
    if (isBbsPage()) return '这是讨论页';
    if (isWorkPage()) return '这是答题页';
    // 只有「看得见、够长、够大」的视频才算视频页。
    // ananas 的 PPT 里常塞一个隐藏的音视频占位，不能让它把翻页整个挡掉。
    const v = pickVideo();
    if (v && visible(v) && (Number(v.duration) || 0) > 10 && (v.clientHeight || 0) > 120) return '这是视频页';
    const path = location.pathname + location.search;
    const pathHit = /ananas|courseware|\/ppt\/|\/doc\/|\/pdf\/|\/slide|slideShow|document|panel|preview/i.test(path);
    const domHit = !!$(
      '#panView, #docContainer, .doc-container, .ppt-container, #fullScreenContainer, .swiper-container, ' +
        '.swiper, #pptDiv, .pptDiv, .ans-module-preview, .ans-module-content, #slideContent, .slide-content, .slide-container'
    );
    if (!pathHit && !domHit) return '地址和 DOM 都不像课件页';
    if (!slideIndicator() && !slideNextBtn() && !slideRoot()) return '没找到页码 / 翻页按钮 / 可滚容器';
    return '';
  }

  function isSlidePage() {
    return slideWhy() === '';
  }

  function slideTick() {
    if (!S.autoSlide) return;
    if (st.slideDone) return;
    const whySkip = slideWhy();
    if (whySkip) {
      if (st.slideSkipLog !== whySkip) {
        st.slideSkipLog = whySkip;
        log('翻页跳过：' + whySkip);
      }
      return;
    }
    st.slideSkipLog = '';
    const now = Date.now();
    const every = Math.min(Math.max((Number(S.slideEvery) || 2) * 1000, 800), 15000);
    const sig = slideSig();

    // 页面变了（翻过去了 / 滚动了）→ 重置
    if (sig && sig !== st.slideSig) {
      if (st.slideSig) {
        st.slideTry = 0;
        st.slideStuck = 0;
      }
      st.slideSig = sig;
      st.slideChangedAt = now;
      const ind = slideIndicator();
      if (ind && ind.total && ind.cur >= ind.total) {
        log('课件翻到最后一页了（' + ind.cur + '/' + ind.total + '）', 'ok');
        st.slideDone = true;
        return;
      }
      if (!ind || !ind.total) {
        // 没有页码的课件：到底了就到底了，别一直滚
        const root = slideRoot();
        if (root && root.scrollTop + root.clientHeight >= root.scrollHeight - 30) {
          log('课件滚到底了，停止翻页', 'ok');
          st.slideDone = true;
          return;
        }
      }
    }

    if (now - st.slideLastTry < every) return;
    st.slideLastTry = now;

    const did = slideAttempt(st.slideTry);
    // 不管这一步使没使上劲，梯子都往前走一格；不然遇到「没有翻页按钮」会死在第 0 步
    st.slideTry = (st.slideTry + 1) % 6;
    if (did) {
      st.slideStuck++;
      log('课件第 ' + st.slideStuck + ' 次翻页：' + did);
    } else {
      st.slideStuck++;
    }

    // 连着好几轮都没动静 → 提示一次就收手，别把页面搓坏
    if (st.slideStuck >= 8 && !st.slideWarned) {
      st.slideWarned = true;
      const done = slideDoneText();
      log(
        done
          ? '课件显示「' + done + '」，不用再翻了'
          : '课件翻不动了（可能已经是最后一页，或者这个课件不认自动翻页），先停手',
        done ? 'ok' : 'warn'
      );
      st.slideDone = true;
    }
  }

  // 手动翻一页：六种办法挨个试，每一步都看位置变没变，日志里说清哪种生效
  async function slideOnceManual() {
    const before = slideSig();
    log('手动翻页：开始，当前位置=' + (before || '没认出来') + '（' + (slideWhy() || '这页算课件') + '）');
    const tried = [];
    for (let k = 0; k < 6; k++) {
      let did = '';
      try {
        did = slideAttempt(k);
      } catch (e) {
        did = '';
      }
      tried.push(did || '第 ' + (k + 1) + ' 种没使上');
      await sleep(900);
      const now = slideSig();
      if (now && now !== before) {
        log('手动翻页：第 ' + (k + 1) + ' 种生效了 —— ' + did + '，位置 ' + now, 'ok');
        return { ok: true, step: k + 1, did, tried };
      }
    }
    log('手动翻页：六种都没推动。试过：' + tried.join(' / '), 'warn');
    return { ok: false, tried };
  }

  function diagPage() {
    log('诊断地址：' + location.hostname + location.pathname.slice(0, 60));
    log('识别结果：' + (isBbsPage() ? '讨论页' : document.getElementById('content2') ? '课程学习页' : '其它页面'));
    const eds = bbsEditors();
    log(
      '可写输入框 ' +
        eds.length +
        '：' +
        eds
          .slice(0, 3)
          .map(
            (e) =>
              e.tagName.toLowerCase() +
              (e.className ? '.' + String(e.className).replace(/\s+/g, '.').slice(0, 30) : '')
          )
          .join(' | ')
    );
    const btns = $$('button, a, span, div, input[type="button"], input[type="submit"]')
      .filter((b) => visible(b) && !b.closest('#fj-cx-panel'))
      .map((b) => String(b.innerText || b.value || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length <= 10);
    log('可见按钮：' + Array.from(new Set(btns)).slice(0, 30).join(' / '));
    log('话题标题：' + bbsTopic().slice(0, 60));
    log('抓到发言 ' + bbsReplies().length + ' 条');
    const ind = slideIndicator();
    log(
      '课件：' +
        (isSlidePage() ? '是' : '否') +
        ' · 页码 ' +
        (ind ? ind.cur + '/' + ind.total : '没认出') +
        ' · 翻页按钮 ' +
        (slideNextBtn() ? '有' : '没有') +
        ' · 可滚容器 ' +
        (slideRoot() ? '有' : '没有')
    );
    log('课件跳过原因：' + (slideWhy() || '无（这页该翻）'));
    const ents = teacherDiscussEntries();
    log(
      '教师讨论入口候选 ' +
        ents.length +
        '：' +
        (ents.slice(0, 6).map((e) => e.text + '[' + e.why + ']').join(' / ') || '一个都没找到')
    );
  }

  /* ================= 初始化 ================= */

  function boot() {
    if (IS_TOP) {
      if (S.showPanel) ensurePanel();
      renderPanel();
    }

    if (IS_TOP) {
      window.addEventListener('message', (e) => {
        if (e.data && e.data.__fj === 'video-ended' && S.autoNext) setTimeout(nextChapter, 2500);
      });
    }

    setInterval(videoTick, 1000);
    setInterval(videoQuizTick, 1500);
    setInterval(workTick, 2500);
    setInterval(harvestTick, 6000);
    setInterval(statsTick, 7000);
    setInterval(discussTick, 6000);
    setInterval(bbsTick, 8000);
    setInterval(slideTick, 1000);
    setInterval(() => {
      if (IS_TOP) renderPanel();
    }, 1500);
    setInterval(() => {
      if (!IS_TOP) return;
      const v = st.video;
      const text = v && v.isConnected ? String(Math.round(v.playbackRate || 1)) + 'x' : '';
      try {
        chrome.runtime.sendMessage({ type: 'fj-badge', text });
      } catch (e) {}
    }, 6000);

    setTimeout(videoTick, 600);
    log('已注入' + (IS_TOP ? '主框架' : '子框架') + '：' + location.hostname + location.pathname.slice(0, 40));
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'fj-ping') {
        sendResponse({ ok: true, top: IS_TOP, url: location.href });
        return;
      }
      if (msg && msg.type === 'fj-discuss-now') {
        st.discussForce = true;
        st.lastDiscussAt = 0;
        if (isBbsPage()) bbsTick();
        else discussTick();
        sendResponse({ ok: true, top: IS_TOP });
        return;
      }
      if (msg && msg.type === 'fj-diag') {
        diagPage();
        sendResponse({ ok: true, top: IS_TOP, url: location.href });
        return;
      }
      if (msg && msg.type === 'fj-discuss-enter') {
        if (!IS_TOP) {
          sendResponse({ ok: false, error: '这条要在主框架点' });
          return;
        }
        ensureDiscussLoaded().then((loaded) => {
          try {
            sendResponse({
              top: true,
              ok: !!loaded,
              how: loaded ? '讨论已加载' : '没进到讨论，看日志'
            });
          } catch (e) {}
        });
        return true;
      }
      if (msg && msg.type === 'fj-slide-once') {
        if (!IS_TOP) {
          sendResponse({ ok: false, error: '这条要在主框架点' });
          return;
        }
        slideOnceManual().then((r) => {
          try {
            sendResponse(Object.assign({ top: true }, r));
          } catch (e) {}
        });
        return true;
      }
      if (msg && msg.type === 'fj-discuss-reset') {
        st.replied = {};
        saveReplied();
        sendResponse({ ok: true });
      }
      if (msg && msg.type === 'fj-purge-old') {
        sendResponse({ ok: true, top: IS_TOP });
        if (IS_TOP) purgeOld();
      }
    });
  } catch (e) {}

  (async function init() {
    await loadSettings();
    loadBankStore();
    loadStats();
    loadReplied();
    watchSettings();
    boot();
  })();
})();