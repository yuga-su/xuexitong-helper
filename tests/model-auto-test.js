'use strict';
// 模型名 404 自动切换的端到端测试：mock 网关 + 真桥 / background
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (cond, name, extra) => {
  if (cond) console.log('  ✅ ' + name);
  else {
    fails++;
    console.log('  ❌ ' + name + (extra ? ' → ' + extra : ''));
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- mock 网关 ----------
const GOOD = 'mock-chat-v2';
const calls = [];
function startGateway(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let buf = '';
      req.on('data', (c) => (buf += c));
      req.on('end', () => {
        if (/\/models(\?.*)?$/.test(req.url)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'mock-embed-3' }, { id: GOOD }, { id: 'mock-vision' }] }));
          return;
        }
        if (/\/chat\/completions$/.test(req.url)) {
          const body = JSON.parse(buf || '{}');
          calls.push(body.model);
          if (body.model !== GOOD) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Model not exist.', code: 'model_not_found' } }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: '多数同学认为先做需求分析是为了避免后期表结构返工。' } }]
            })
          );
          return;
        }
        res.writeHead(404);
        res.end('{}');
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

// ---------- 1) 桥：config 里模型名故意写错 ----------
async function testBridge(port) {
  console.log('\n[1] 本地桥：config.json 的 model 写错，应自动换');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fjbridge-'));
  fs.mkdirSync(path.join(tmp, 'bridge'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'bridge', 'fj-bridge.js'), path.join(tmp, 'bridge', 'fj-bridge.js'));
  fs.writeFileSync(
    path.join(tmp, 'bridge', 'config.json'),
    JSON.stringify({ port, baseURL: 'http://127.0.0.1:17321/v1', model: 'deepseek-chat', apiKey: 'sk-test' })
  );
  const child = execFile(process.execPath, [path.join(tmp, 'bridge', 'fj-bridge.js')], { cwd: tmp });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  await wait(1200);

  const r = await fetch(`http://127.0.0.1:${port}/summarize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: '数据库设计为什么要先做需求分析', replies: ['需求不清会返工'], maxLen: 60 })
  });
  const data = await r.json();
  ok(r.status === 200 && data.ok, '桥返回 200 且有结果', r.status + ' ' + JSON.stringify(data).slice(0, 120));
  ok(!!data.text, '拿到一句话', data.text);
  ok(/自动换模型/.test(log), '桥日志里写了自动换模型', log.slice(-200));

  const m = await (await fetch(`http://127.0.0.1:${port}/models`)).json();
  ok(m.ok && m.count === 3, '/models 能列出 3 个模型', JSON.stringify(m).slice(0, 120));
  ok(m.model === GOOD, '/models 报的是换完的模型', m.model);

  child.kill();
  await wait(300);
  return log;
}

// ---------- 2) background 直连：模型名错 ----------
async function testDirect() {
  console.log('\n[2] background 直连：模型名写错，应自动换并回报 modelSwitched');
  const store = {};
  global.chrome = {
    storage: {
      session: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (o) => Object.assign(store, o),
        remove: async (k) => delete store[k]
      },
      local: { get: async () => ({}), set: async () => {} }
    },
    runtime: {
      onMessage: { addListener: (fn) => (global.__onMsg = fn) },
      sendMessage: async () => ({})
    },
    tabs: { onRemoved: { addListener() {} }, remove: async () => {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
  };
  require(path.join(ROOT, 'background.js'));
  const call = (msg) =>
    new Promise((resolve) => {
      global.__onMsg(msg, { tab: { id: 1 } }, resolve);
    });

  const res = await call({
    type: 'fj-ai',
    cfg: { mode: 'direct', base: 'http://127.0.0.1:17321/v1', key: 'sk-test', model: 'deepseek-chat' },
    topic: '数据库设计为什么要先做需求分析',
    replies: ['需求不清会返工'],
    maxLen: 60
  });
  ok(res && res.ok, '直连返回 ok', JSON.stringify(res).slice(0, 160));
  ok(res && res.model === GOOD, '回报了换过的模型名', res && res.model);
  ok(res && res.modelSwitched === GOOD, '回报 modelSwitched', res && res.modelSwitched);
  ok(res && /多数同学认为/.test(res.text || ''), '拿到那句话', res && res.text);
}

(async () => {
  const gw = await startGateway(17321);
  try {
    await testBridge(17322);
    await testDirect();
  } finally {
    gw.close();
  }
  console.log(fails ? '\nMODEL_AUTO_FAIL ' + fails : '\nMODEL_AUTO_OK');
  process.exit(fails ? 1 : 0);
})();