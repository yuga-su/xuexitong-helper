// 用假 chrome 跑 background.js，验证 fj-ai / fj-ai-health 两条链路
// 全程打本地 mock 服务，不联网、不需要真 Key
const path = require('path');
const http = require('http');

const store = {};
const listeners = [];

global.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => listeners.push(fn) },
    lastError: null
  },
  storage: {
    session: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => delete store[k]
    }
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: { onRemoved: { addListener: () => {} } }
};

require(path.join(__dirname, '..', 'background.js'));

const call = (msg) =>
  new Promise((resolve) => {
    listeners.forEach((fn) => fn(msg, { tab: { id: 1 } }, resolve));
  });

// 一个假上游：/health、/summarize、/chat/completions 都能应付
function startMock() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') {
        res.end(JSON.stringify({ ok: true, service: 'mock', model: 'mock-model' }));
        return;
      }
      if (req.url === '/summarize') {
        res.end(JSON.stringify({ ok: true, text: '多数同学认为先确定需求再画 ER 图，能减少后期返工。', model: 'mock-model' }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        res.end(JSON.stringify({ choices: [{ message: { content: '多数同学认为先确定需求再画 ER 图，能减少后期返工。' } }] }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const fails = [];
  const ok = (cond, name, extra) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
    if (!cond) fails.push(name);
  };

  const server = await startMock();
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  const health = await call({ type: 'fj-ai-health', cfg: { url: base + '/summarize' } });
  ok(health && health.ok, '桥 health 在线', JSON.stringify(health && health.url));

  const r = await call({
    type: 'fj-ai',
    cfg: { mode: 'bridge', url: base + '/summarize' },
    topic: '数据库设计为什么要先做需求分析',
    replies: ['需求不清楚后面表结构全要返工'],
    maxLen: 60
  });
  ok(r && r.ok, '桥模式出话', r && r.text);
  ok(r && r.text && r.text.length <= 60, '字数不超上限', String(r && r.text && r.text.length));
  ok(r && r.text && !/^(总结|回复)[：:]/.test(r.text), '没有多余前缀');

  const bad = await call({
    type: 'fj-ai',
    cfg: { mode: 'bridge', url: 'http://127.0.0.1:17999/summarize' },
    topic: '测试连不上桥',
    replies: []
  });
  ok(bad && !bad.ok && /连不上 AI 桥|连不上 AI 服务/.test(bad.error), '桥没开时报错说清楚', bad && bad.error);

  const direct = await call({
    type: 'fj-ai',
    cfg: { mode: 'direct', base, key: 'sk-placeholder-not-a-real-key', model: 'mock-model' },
    topic: '讨论一下课程设计',
    replies: ['先把需求确定再画 ER 图'],
    maxLen: 50
  });
  ok(direct && direct.ok, '直连模式出话', direct && direct.text);

  server.close();
  console.log(fails.length ? 'BG_TEST_FAIL ' + JSON.stringify(fails) : 'BG_TEST_OK');
  process.exit(fails.length ? 1 : 0);
})();