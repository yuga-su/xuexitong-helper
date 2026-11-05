# 学习通助手（xuexitong-helper）

> 一个跑在 Edge / Chrome 上的学习通（超星）辅助扩展：自动刷课、章节测验自动作答、本地题库自增长，再配一个本机 AI 小桥，帮你把章节讨论和 BBS 话题用一句话回完。

- 纯前端扩展 + 本机 Node 小桥，**不经过任何第三方服务器**，课程 Cookie 和 API Key 都留在自己电脑上
- 视频、答题、讨论三块互相独立，可以只开其中一块
- 所有动作都有日志，面板上看得见它在干什么

---

## 功能一览

| 模块 | 能力 |
| --- | --- |
| 视频 | 自动播放、自动静音、1–16 倍速、卡住自动微调进度、视频弹题自动作答、播完自动下一节 |
| 章节测验 / 作业 | 自动识别单选题、多选题、判断题、填空题；题库命中即填；可自动提交（默认关闭，先让你核对） |
| 本地题库 | 导入 / 导出 JSON；提交后从答案页回收正确答案入库；累计答对率统计 |
| 章节讨论 | 课程页右栏「讨论」里的话题，AI 读完全部发言后写一句话，你点头才发 |
| BBS 话题页 | `groupweb.chaoxing.com/course/topic/v3/bbs/...` 这类独立话题页同样支持 |
| 人工把关 | 发送前弹确认卡片，可改字、可「换一句」、按 Esc 不发 |
| 统一回复 | 同一话题只留一条：能编辑就原位改，不能编辑就删掉旧的再发新的 |
| 收尾 | 回复完成后自动关闭该话题页标签 |

详细用法见 [docs/USAGE.md](docs/USAGE.md)。

---

## 安装（Edge 或 Chrome）

1. 把仓库克隆或下载到本地任意目录（路径别带空格更省事）：

   ```bash
   git clone https://github.com/yuga-su/xuexitong-helper.git
   ```

2. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`），打开「开发人员模式」。
3. 点「加载解压缩的扩展」，选择仓库根目录（就是包含 `manifest.json` 的那一层）。
4. 打开学习通任意课程页，右上角出现悬浮面板即注入成功。

> 扩展更新后，回到扩展页点该扩展卡片上的「重新加载」，再刷新学习通页面。

---

## AI 回复怎么用

AI 功能需要一个「桥」：一个跑在本机的小服务，替扩展去调用大模型。这样 API Key 不出本机，也不受网页 CSP 限制。

```bash
# 1. 准备配置
cd bridge
copy config.example.json config.json      # macOS/Linux: cp config.example.json config.json

# 2. 填 Key（二选一）
#    改 config.json 的 apiKey 字段，或者启动前设置环境变量
set DS_API_KEY=sk-你的key                   # macOS/Linux: export DS_API_KEY=sk-...

# 3. 启动（Windows 也可以直接双击 启动AI桥.bat）
node fj-bridge.js
```

看到 `[自检] ✅ 上游可用` 就说明桥通了，**这个窗口要一直开着**。

`config.json` 三个关键字段：

| 字段 | 说明 |
| --- | --- |
| `baseURL` | OpenAI 兼容地址，例如 `https://api.deepseek.com/v1` |
| `model` | 模型名，例如 `deepseek-chat` |
| `apiKey` | 你的 Key；留空则用环境变量 `DS_API_KEY` |

> 任何 OpenAI 兼容网关都能用（DeepSeek 官方、各家兼容模式、自建 one-api 等），只要 `baseURL` 和 `model` 对得上。

桥只有两个接口：`GET /health` 和 `POST /summarize`，代码不到 300 行，可以自己审。

不想起桥也行：弹窗里把模式切成「直连」，填 `baseURL` + Key + 模型名，扩展自己去请求（缺点是 Key 存在扩展存储里）。

---

## 目录结构

```
xuexitong-helper/
├── manifest.json           # MV3 清单
├── background.js           # Service Worker：日志、AI 中转、关标签页
├── content.js              # 主逻辑：刷课 / 答题 / 讨论
├── inject.js               # 注入页面主世界：改写 confirm/alert/visibility
├── content.css             # 悬浮面板与确认卡片样式
├── popup.html / .css / .js # 右上角弹窗
├── icons/                  # 图标 16/32/48/128
├── bridge/
│   ├── fj-bridge.js        # 本地 AI 桥（零依赖，Node 18+）
│   ├── config.example.json # 配置模板
│   └── 启动AI桥.bat         # Windows 一键启动
├── tests/                  # 本地测试台（假 DOM，不联网）
├── docs/USAGE.md           # 详细使用文档
└── LICENSE
```

---

## 开发与测试

测试不依赖浏览器，也不需要网络和真 Key：

```bash
node tests/bbs-test.js            # 讨论页 / 学习页两条链路
FJ_EDIT=1 node tests/bbs-test.js  # 旧回复可编辑时走原位替换
FJ_OLD=0 node tests/bbs-test.js   # 页面上没有旧回复
FJ_CLOSE=0 node tests/bbs-test.js # 不自动关标签页
FJ_MODE=study node tests/bbs-test.js
node tests/popup-test.js          # 弹窗取值与容错
node tests/bg-test.js             # background 的桥模式 / 直连 / 失败文案
```

改完代码记得 `node --check` 一遍。

---

## 版本号怎么算

语义化版本：**大改升 MAJOR，新功能升 MINOR，修 bug 升 PATCH**。

早期是边做边加数字（0.1 → 3.5），数字和改动量对不上，所以公开版从 `1.0.0` 重新计。对照表：

| 内部旧号 | 现行版本 | 内容 |
| --- | --- | --- |
| 0.1.0 | — | 第一版：自动播放 |
| 0.1.1 | — | 自动点播放器大按钮 |
| 2.0.0 | — | 本地题库、导入导出、正确率 |
| 3.0.0 | — | AI 桥 + 章节讨论一句话 |
| 3.1.0 | — | 支持 BBS 话题页、诊断按钮 |
| 3.2.0 | — | 桥自检、报错说人话 |
| 3.3.0 | — | 发送前确认卡片、换一句 |
| 3.4.0 | — | 口气客观化、回完关标签页 |
| 3.5.0 | **1.0.0** | 统一回复：只留一条、旧的不再喂给模型 |

---

## 隐私

- 数据只存在本地 `chrome.storage`：题库、日志、设置都不上传
- `bridge/config.json` 已在 `.gitignore` 中，不会被误提交
- 讨论摘要的请求只发给你自己配置的模型地址

---

## 已知限制

- 学习通改版、换类名可能让选择器失效；用面板日志和「诊断当前页」可快速定位
- 答题命中率取决于题库积累；新题会先留空或按兜底策略填
- 不处理人脸识别 / 摄像头监考的考试
- AI 写的话需要自己过一眼，异常判定风险由使用者承担

---

## 免责声明

本项目仅供个人学习研究与自动化练习使用。请遵守所在学校的学术规范与学习通用户协议；因使用本工具产生的任何后果由使用者自行承担。

## License

[MIT](LICENSE) © 2026 yuga-su