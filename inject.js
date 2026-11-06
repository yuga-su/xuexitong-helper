/*!
 * 页面上下文补丁（world: MAIN）
 * 作用：
 *  1. 自动确认学习通各种 confirm 弹窗（提交确认、继续学习确认等）
 *  2. 屏蔽页面用来判断"切屏暂停"的 hidden / visibilityState / hasFocus
 * 该文件运行在网页主世界，不能使用 chrome.* API。
 */
(() => {
  'use strict';
  if (window.__FJ_MAIN__) return;
  window.__FJ_MAIN__ = true;

  const rawConfirm = window.confirm;
  const rawAlert = window.alert;

  window.confirm = function (msg) {
    try { console.log('[学习通助手] 自动确认：', msg); } catch (e) {}
    return true;
  };

  window.alert = function (msg) {
    try { console.log('[学习通助手] 拦截 alert：', msg); } catch (e) {}
  };

  // 有些页面用 document.hidden / visibilityState 判断是否切走
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  } catch (e) {}

  // 失焦检测
  try {
    document.hasFocus = function () { return true; };
  } catch (e) {}

  // 失焦后把焦点事件补回来，诱导页面认为还在前台
  window.addEventListener(
    'blur',
    () => {
      setTimeout(() => {
        try {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        } catch (e) {}
      }, 200);
    },
    true
  );

  // 页面如果靠 document.addEventListener('visibilitychange') 暂停，也会被上面的 focus 事件带偏
  try { console.log('[学习通助手] 页面补丁已注入', rawConfirm ? '' : ''); } catch (e) {}

  /* ---------- 给扩展当“手”用：调用页面自己的函数 ---------- */
  // 扩展在隔离世界只能用 DOM，很多学习通逻辑藏在页面函数里（发讨论回复、拉讨论列表）。
  // 这里接收 JSON 字符串形式的调用请求，在主世界执行。
  const ALLOWED = {
    addDiscussReply: true,
    getChapterRightDiscuss: true,
    getGroupChapterRightDiscuss: true,
    changePan: true,
    replay: true,
    greenligth: true,
    finishJob: true
  };

  const onCall = (ev) => {
    let payload;
    try {
      payload = JSON.parse(ev.detail);
    } catch (e) {
      return;
    }
    const name = payload && payload.name;
    const reply = (ok) => {
      try {
        document.dispatchEvent(
          new CustomEvent('fj-page-result', {
            detail: JSON.stringify({ name, ok }),
            bubbles: true,
            composed: true
          })
        );
      } catch (e) {}
    };
    if (!ALLOWED[name] || typeof window[name] !== 'function') {
      try { console.log('[学习通助手] 页面函数不可用：', name); } catch (e) {}
      reply(false);
      return;
    }
    try {
      window[name].apply(window, payload.args || []);
      reply(true);
    } catch (e) {
      try { console.log('[学习通助手] 调用页面函数失败', name, e); } catch (e2) {}
      reply(false);
    }
  };

  // document 上派发的事件只有 bubbles 才会冒到 window，两处都收一遍最稳
  window.addEventListener('fj-page-call', onCall);
  document.addEventListener('fj-page-call', onCall);

  /* ---------- 学习通自己的小动作，顺手掐掉 ---------- */

  // 1) 手机端学习检测：超星会弹「请用手机学习」，拦掉这个函数就安静了
  try {
    window.checkMobileBrowerLearn = function () {};
  } catch (e) {}

  // 2) 切窗口暂停：有些页面监听 mouseout 判「人走了」，捕获阶段直接掐断
  try {
    document.addEventListener(
      'mouseout',
      (ev) => {
        try { ev.stopPropagation(); } catch (e) {}
      },
      true
    );
  } catch (e) {}

  // 3) 视频弹题：页面拉 richvideo/initdatawithviewerV2 拿题目，直接给它一个空数组
  try {
    const rawOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      const hit = typeof url === 'string' && url.indexOf('richvideo/initdatawithviewerV2') >= 0;
      if (hit) {
        this.addEventListener('readystatechange', function () {
          if (this.readyState === 4) {
            try {
              Object.defineProperty(this, 'responseText', { writable: true, configurable: true });
              this.responseText = JSON.stringify([]);
            } catch (e) {}
          }
        });
      }
      return rawOpen.apply(this, arguments);
    };
  } catch (e) {}
})();