# QQ ↔ DeepSeek Harness 桥接

**English**: [README.en.md](README.en.md) | **中文**: [README.md](README.md)

> 📘 详细内外核说明书见 **[docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)**（架构、数据流、配置全解、调试与改进指南）。

把 QQ 消息接入 DSH agent：QQ 好友/群发来的消息会变成 DSH 会话里的用户消息，agent 的回复（含提问、工具审批）会发回 QQ。

> ⚠️ **本分支/版本适配 DSH 0.1.5-rc.1**（已在 0.1.2-alpha.1 / 0.1.1-rc.2 上验证过同一协议）。使用 Cookie 鉴权、斜杠 RPC 和 `/api/remote.mux` 事件流；与旧版 DSH 协议不兼容。旧版请使用 `main` 分支。

```
QQ 消息 ──► SnowLuma（OneBot v11 WS）──► 本桥接进程 ──► DSH Web API (127.0.0.1:3080/api)
                                                ▲                      │
                                                └── agent 回复/提问/审批 ┘
```

## 项目展示

📽️ [AI 仿真群友 - 项目介绍视频](assets/project-intro.mp4)

> 视频文件位于 `assets/project-intro.mp4`，可直接下载观看。

## 架构

- **QQ 侧**：`@snowluma/sdk` 的 `SnowLumaWebSocketClient`（OneBot v11 WebSocket 客户端，自动重连）
- **DSH 侧**：适配 DSH 0.1.2 起、0.1.5 复核通过的协议——launch token 换 Cookie 鉴权、`/api/<namespace>/<method>` 斜杠 RPC、`/api/remote.mux` + `session/follow` 事件流；复用 `AbstractApiClient` 传输层但不再依赖旧版 zod value schema。会话模型由桥接按 `config.json` 的 `dsh.model` 逐会话 `session.selectModel` 固定（默认 `deepseek-flash` = DeepSeek-V41-Flash，多模态）
- **agent 自主收发 QQ**：DSH 的 MCP 客户端（`~/.dsh/profiles/web/cordis.patch.yml` 配置）接入三个 MCP server：
  - `snowluma`（桥接自带 `src/mcp-snowluma-safe.js`）：QQ 动作**安全子集**（查状态/查群/查消息/发消息，发送强制白名单；发送工具支持可选 `replyToMessageId` 引用回复）
  - `snowluma-host`（桥接自带 `src/mcp-host-server.js`）：`snowluma_status`（默认只读探活）；`start_snowluma` / `stop_snowluma` 需显式开启 `snowluma.allowProcessControl: true` 且仅在 `closed-agent` 模式可用
  - `web-search-safe`（桥接自带 `src/mcp-web-search-safe.js`）：只读 `web_search` / `web_fetch`（带 SSRF 防护），供 agent 查网络用语/资料
- **会话模型**：每个 QQ 会话（私聊/群）对应一个独立的 DSH 会话，统一归组到「QQ 聊天」工作区（不再散落未分组）；映射持久化在 `state/sessions.json`
- **性格定制**：QQ 会话默认使用 `qq-chat` agent preset（`~/.dsh/.agent-presets/qq-chat/agent.cordis.yml`），`reserved2` 使用 `qq-chat-v2`（`~/.dsh/.agent-presets/qq-chat-v2/agent.cordis.yml`）；人格与默认 DSH 一致（coding agent），仅附加 QQ 场景规则；**角色扮演**是可选机制——由控制台或管理端设置 `state/current-role.json` 注入（群友无法更改）
- **本地控制台**：桥接自带 Web 控制台 `http://127.0.0.1:3100`——切换运行模式（chat / closed-agent / reserved / reserved2）、设置角色、静默开关、查看活动日志、修改管理员/控制台令牌，全部即时生效；访问需要令牌（`config.json` 的 `consoleToken`，未配置时自动生成并打印在启动日志；控制台内可手动修改或重新生成）
- **运行模式**：
  - `chat`：白名单群 + 白名单私聊 → qq-chat 安全聊天
  - `closed-agent`：仅私聊 owner（config.json 的 ownerQQ，可在控制台设置）→ 完整工具（默认用 DSH 自己声明的默认 preset，即 `standard`；可在控制台「closed-agent preset」下拉改为任意 DSH preset），可在 QQ 上操控 DSH
  - `reserved`（一代仿真）：仿真群友，观望/活跃/试探/退场状态机，选择性参与、按空格分句发送、主动收尾
  - `reserved2`（二代仿真，运行 `setup-dsh.mjs` 后 DSH 默认）：文本不自动转发，AI 通过 `qq_get_unread_messages` / `qq_send_message` 等工具自主看消息、发言、等待、设置唤醒/潜水；DSH 端使用 `qq-chat-v2` preset
- **交互增强**：
  - agent 通过 `ask_user_question` 提问时，问题会转发到 QQ，回复即自动应答
  - agent 请求工具审批时，转发到 QQ，回复「通过」/「拒绝」即可决策
  - 支持 DSH 斜杠命令（如 `/model`）与 `/reset`（重置会话上下文）
  - 群聊引用/回复会解析成「被引用人 + 原文」注入 DSH（如 `[引用 Derp：El Psy Kongroo是啥]机关的走狗`），让 AI 判断这句话是对谁说的，不会把群友之间引用第三方的对话误当成指向自己；引用机器人自己时会被视为必回
  - MCP 发送工具支持可选 `replyToMessageId`，并新增专用 `qq_reply` 工具：AI 可以先用 `qq_get_group_history` 拿到真实消息 id，再引用/回复某条消息（是否允许 AI 主动使用由人格/策略决定；桥接会检测发送类工具调用并自动跳过该回合的重复自动转发）
  - 一代仿真模式（`reserved`）下，AI 可以只输出 `[SILENT]` 表示“潜水/不接话”，桥接会静默不发送
  - 一代仿真模式（`reserved`）按空格分句：AI 用空格表示拆成多条消息；中英文/数字之间的空格也会被当成分条信号，不想分条就不要加空格（`reserved2` 不适用，分条请用 `qq_send_message` 数组）

## 前置条件

1. 运行中的 DeepSeek Harness Web（默认 `http://127.0.0.1:3080`）
2. 运行中的 SnowLuma，且配置好 OneBot WebSocket 与 HTTP API（默认 `ws://127.0.0.1:3001` / `http://127.0.0.1:3000`，`accessToken` 视配置填写）
3. Node.js ≥ 22.13

## 安装与配置

```bash
npm install        # 安装依赖（postinstall 会自动修补 @snowluma/sdk 的 ESM 打包 bug）
```

复制 `config.example.json` 为 `config.json` 后编辑：

> Windows CMD 用户请用：`copy config.example.json config.json`

> ⚠️ 真实 `config.json` 与 `state/` 不会进入公开仓库，仓库只提供脱敏的 `config.example.json` 模板。

| 字段 | 说明 |
| --- | --- |
| `dsh.baseUrl` | DSH Web 地址，默认 `http://127.0.0.1:3080` |
| `dsh.provider` / `dsh.model` / `dsh.reasoningEffort` | DSH 会话使用的模型/推理强度；若你的 DSH 没有示例中的模型，改成 DSH 设置页里可用的模型即可（选择失败只打日志，不阻塞启动） |
| `dsh.authToken` | DSH launch token（新版 DSH 用于换取 Cookie 的进程启动 token）。留空时桥接会自动从 `~/.dsh/guard/logs/server-*.out.log` 发现；DSH 重启后遇到 401 也会自动重新发现并换 Cookie |
| `dsh.authHeader` / `dsh.authPrefix` | 保留字段，当前新版 DSH 链路使用 Cookie 交换，不再直接发送该鉴权头 |
| `snowluma.wsUrl` | SnowLuma OneBot **WebSocket** 地址（如 `ws://127.0.0.1:3001`） |
| `snowluma.httpUrl` | OneBot **HTTP API** 地址（如 `http://127.0.0.1:3000`）；不要填 WebSocket 端口，否则会报 HTTP 426 |
| `snowluma.accessToken` | OneBot accessToken，未配置留空 |
| `snowluma.launcherPath` / `homeDir` | SnowLuma 启动脚本与安装目录（供 agent 自动启动/停止） |
| `agentPreset` | QQ 会话使用的 DSH agent preset，默认 `qq-chat`（改性格见下文） |
| `socialV2.agentPreset` | `reserved2` 模式使用的 DSH agent preset，默认 `qq-chat-v2` |
| `workspaceTitle` | QQ 会话在 DSH 界面中的归组名称，默认「QQ 聊天」 |
| `allow.private` / `allow.groups` | 白名单（QQ 号/群号数组）；留空且 `allowAllWhenEmpty: true` 时放行全部 |
| `deny.*` | 黑名单，优先于白名单 |
| `ackMessage` | 消息投递后的立即回复，空字符串关闭 |
| `sendDelayMs` | QQ 连续发送间隔，防止触发频率限制 |
| `consolePort` | 本地控制台端口，默认 `3100` |
| `consoleToken` | 控制台访问令牌；留空时启动自动生成并保存到 `state/console-token` |
| `media.*` | **媒体与图源**：`enabled`（总开关）、`maxDurationMin`（视频时长上限，默认 2 分钟）、`maxSizeMB`（下载大小上限，默认 100）、`quality`（`low`/`high`）、`maxImageMB`、`imageCategory`、`imageCooldownMs`（随机图冷却） |
| `media.proxy` | **只用于 Pixiv 官方 CDN（`i.pximg.net`）** 的图片下载，B站/抖音一律直连。留空 = 不走代理；填了但代理没运行会自动跳过并回退 |
| `media.bilibiliCookie` | B站登录态（可选，用于解析视频）；不填也能解析公开视频 |
| `media.pixivBadTags` | **追加**到内置黑名单的 Pixiv 标签（用来堵新发现的漏网词，不用改代码） |
| `qwen.apiKey` | DashScope 密钥。不填就只有纯文字，**不能看图 / 看视频 / 画图** |
| `qwen.videoEnabled` / `videoMaxSeconds` / `videoFps` | 让模型"看懂视频"的开关与采样参数 |
| `whisper.cli` / `whisper.model` | 语音转写用的本地 whisper 可执行文件与模型路径（可选；本地跑，音频不出网） |

> ⚠️ `allowAllWhenEmpty: true` 表示「白名单没填就全部放行」——把 agent 接入 QQ 等于把账号控制权交给了模型，建议先填白名单。

### DSH 端安装（另一台设备 / 新环境）

桥接和控制台能跑起来还不够，DSH 端还需要安装两个聊天 preset（`qq-chat` / `qq-chat-v2`）并挂载 MCP：

```bash
node scripts/setup-dsh.mjs
```

> 全新环境下脚本会把 DSH 默认模式设为 **`reserved2`（二代仿真）**，并创建本地 `state/mode.json` 兜底；这样 AI 使用 `qq_send_message` 等工具收发消息时，DSH 会自动使用 `qq-chat-v2` 模式。如果本机已存在旧的 `state/mode.json` 或 DSH 设置值，脚本会保留不覆盖。之后可在**桥接控制台**（默认 `http://127.0.0.1:3100`）顶部按钮切换模式，控制台会同时写入 DSH 设置与本地兜底文件。

详细步骤见 **[docs/DSH_SETUP.md](docs/DSH_SETUP.md)**。

## 完整启动流程（从零开始）

共 5 步，DSH 和桥接都已就绪，缺的只是 SnowLuma 本体：

1. **DSH**（已运行，无需操作）
   确认 `http://127.0.0.1:3080` 能打开即可。

2. **下载并解压 SnowLuma**
   - 下载：<https://github.com/SnowLuma/SnowLuma/releases/latest> 选 `SnowLuma-v<版本>-win-x64.zip`（完整版，自带 Node 运行时；Lite 版需本机 Node 22.13+）
   - 解压到任意目录（例如 `C:\SnowLuma`），双击 `launcher.bat`

3. **首次引导（WebUI）**
   - 打开启动日志里的 WebUI 地址（README 写的是 `http://localhost:5099`，以你启动日志里实际打印的为准）
   - 用**启动日志中的初始密码**登录，按引导：同意条款 → 设置密码 → 接入 QQ 进程（扫码登录）
   - 在 WebUI 里配置 OneBot 连接：开启 **WebSocket 服务端** 和 **HTTP API**，分别记下**端口**（默认 WS `3001`、HTTP `3000`）和 **accessToken**（若配置了）

4. **填写桥接配置**（`config.json`）
   ```json
   "snowluma": {
     "wsUrl": "ws://127.0.0.1:3001",
     "httpUrl": "http://127.0.0.1:3000",
     "accessToken": "你在 WebUI 里配置的 token（没配置就留空）"
   }
   ```
   `wsUrl` 是 OneBot **WebSocket** 端口，`httpUrl` 是 OneBot **HTTP API** 端口（不要填成同一个 WS 端口，否则 MCP 工具会报 HTTP 426）。
   建议顺手把 `allow.private` / `allow.groups` 白名单填上。

5. **启动桥接**
   ```bash
   cd qq-bridge
   npm start          # 或双击 start.bat
   ```
   看到 `SnowLuma 已连接` 即成功；然后 QQ 上给机器人账号发条消息测试。

## 运行与运维

```bash
npm start          # 或双击 start.bat（守护模式：崩溃自动重启，关闭窗口即停止）
```

**⚠️ 重要**：
- **桥接只能运行一个实例**（有单实例锁，重复启动会被拒绝并提示"已有实例在运行"）
- **用 start.bat 启动**（守护模式），窗口别关——桥接崩溃会在 5 秒后自动拉起
- 桥接异常/消息无反应时：双击 `restart.bat`（自动杀旧实例 → 清理锁 → 重新启动守护）
- **重启 DSH 不需要动桥接**：桥接会自动检测 DSH 恢复（每 5 秒探活），DSH 重启期间收到的 QQ 消息会**入队缓存**（最多 50 条/会话），恢复后自动补投，不会丢
- 修改 `config.json` / `roles/` / `state/current-role.json` 后重启桥接生效；修改 `~/.dsh/.agent-presets/qq-chat*/` 或 MCP 配置后重启 DSH 生效

日志示例：

```
12:00:01 [bridge] SnowLuma 已连接：ws://127.0.0.1:3001
12:00:02 [bridge] 新会话 private:12345678 -> sess_xxxx
12:00:02 [bridge] 已投递 private:12345678: 你好
12:00:20 [bridge] agent 回复 (private:12345678) 42 字
```
```

## 自测（不需要 SnowLuma / QQ）

验证 DSH 侧链路是否打通（会创建一个独立测试会话，不影响现有会话）：

```bash
npm run self-test
```

预期输出：连接成功 → 测试会话创建 → prompt 被接受 → 打印 agent 回复。

## 目录结构

```
qq-bridge/
  config.example.json   # 配置模板（脱敏占位符；真实 config.json 不入库）
  docs/
    PROJECT_GUIDE.md    # 公开版项目说明书
  dsh/agent-presets/    # qq-chat / qq-chat-v2 的 DSH agent preset 模板
  plugins/qq-mode-console  # DSH 插件：注册 qq-mode 设置命名空间（仅 host 半，UI 卡片未实现）
  src/
    bridge.js           # 主程序
    dsh-client.js       # Node 版 DSH API 客户端（WS 下行）
    md-to-plain.js      # Markdown → QQ 纯文本
    self-test.js        # DSH 侧自测
  scripts/              # 测试/运维脚本（含 postinstall 的 patch-snowluma-sdk.mjs）
    patch-snowluma-sdk.mjs  # 修补 SDK 的 ESM 打包 bug（postinstall 自动执行）
  state/                # 运行时数据（不入库）
```

## 功能说明（媒体与互动）

### 机器人能"自己动手"做的事

- **B站 / 抖音链接自动转发**：群里有人贴链接（含 `b23.tv` 短链、裸 BV 号），桥会在后台下载视频并直接发到群里。
  受 `media.maxDurationMin`（默认 2 分钟）与 `media.maxSizeMB`（默认 100MB）限制，超限会说明原因而不是静默失败。
  ⚠️ 下载要几秒到几十秒，**刻意不阻塞消息处理**，所以视频会晚于文字出现。
- **看懂图片 / 表情包**：需要 `qwen.apiKey`。另外支持"随机图"——说"来张猫图"这类话时，会从图源取一张发出来。
- **本地语音转写**：配置 `whisper.*` 后，语音消息转成文字（本地跑，**音频不出网**）。
- **看懂视频**：别人发 QQ 视频时不再只给模型看 `[视频]` 两个字，而是抽帧理解（`qwen.videoEnabled`）。

### 卡片与转发

- **分享卡片自动解析**：别人分享的 B站 / 公众号 / 小程序卡片（OneBot 的 `json` 段），会被解析成「标题 + 平台 + 链接」给模型看，**不再只是一个 `[卡片消息]` 占位符**。
- **卡片里的视频也会被发出来**：解析出 `b23.tv` 链接后走同一条媒体解析链路，效果和直接贴链接一样。
- **合并转发自动展开**：群里转发的聊天记录会在后台取回内容并放进上下文，模型能直接读到里面每个人说了什么（否则它只会看到一个 id 占位符）。

### 图源与内容分级

- **Pixiv 图源**：`media.proxy` 仅用于 Pixiv 官方 CDN，需要在本机代理里放行 `i.pximg.net`；没开代理会自动回退到反代。
- **R18 按会话独立开关**：**默认关闭**（回避成人向话题）。开关在状态总览页 `http://127.0.0.1:3100/status` 上，**每个群/私聊单独勾选**；打开只解除"回避"，三条红线（未成年人 / 非自愿胁迫 / 线下见面钱财）在任何状态下都不放行。

### 自动回复

- 每会话每小时唤醒额度 **30 次**；**被 @ 或拍一拍不受整点额度限制**（仍受每分钟 1 次限制），保证被点名一定有反应。
- 控制台状态总览页可查看各会话的未读、水位、R18 开关与响应档位。

## 已知限制

- agent 回复在回合结束时一次性发送（不做流式逐字转发）；回复超过 4000 字自动分段
- 图片/语音/视频会在有 `qwen.apiKey`（看图/画图/看视频）或配好 `whisper.*`（语音转写）时才被理解，否则退化成 `[图片]` 这类占位文本
- 媒体自动转发依赖 SnowLuma 的发送侧支持 `video` 段；老版本协议端可能发不出视频
- agent 的 Markdown 回复会转成纯文本（链接保留 `文字 (url)` 形式）
- `@snowluma/sdk` 的 npm 发布版存在 ESM 扩展名 bug，本仓库通过 postinstall 补丁修复（见 `scripts/patch-snowluma-sdk.mjs`）

## 合规提醒

SnowLuma 是独立第三方项目，与腾讯/QQ 无隶属关系，仅供学习与技术研究；使用前请阅读其 EULA 与《QQ 用户协议》。
