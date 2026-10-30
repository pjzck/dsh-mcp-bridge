# dsh-mcp-bridge

把 DeepSeek Harness 暴露成 MCP server，让 Codex 等客户端调用 DSH 执行任务。

```text
MCP client → dsh-mcp-bridge → dsh --profile <SDK profile> → DSH agent
```

桥负责会话、路由和结果。提供商与认证由 DSH adapter 执行；公司网关、个人 API、自定义 provider 都通过连接配置选择。

## 安装

要求 Node.js 22+、pnpm，以及支持 `session/wait` 的 DSH SDK runtime（本次验证为 Desktop 0.2.1-rc.5）。默认从 PATH 查找 `dsh`，也可通过配置的 `command` 或 `DSH_MCP_DSH_COMMAND` 指定桌面版启动器。

```sh
git clone https://github.com/pjzck/dsh-mcp-bridge.git
cd dsh-mcp-bridge
pnpm install --frozen-lockfile
pnpm test
```

## 连接配置

可选 JSON 配置默认放在 `~/.dsh/mcp-bridge.json`；`DSH_MCP_CONFIG` 可指定其他文件。复制仓库的 `mcp-bridge.example.json` 后填写自己的值。没有文件时使用 PATH 中的 dsh、默认 DSH home 和 SDK profile，保留旧版环境变量用法。

```json
{
  "defaultConnection": "personal",
  "profile": "sdk",
  "connections": {
    "personal": {
      "provider": "deepseek-official",
      "model": "deepseek-flash",
      "baseURL": "https://api.deepseek.com",
      "apiKeyEnv": "DEEPSEEK_API_KEY"
    },
    "company": {
      "provider": "deepseek-official",
      "model": "deepseek-flash",
      "baseURL": "https://gateway.example.com/v1",
      "apiKeyEnv": "COMPANY_API_KEY"
    }
  }
}
```

公司地址是示例，填写自己提供商的兼容地址。API key 放在所选名称的环境变量或所选 home 的 `.credentials.yaml` 中；支持 DSH 的 `version: 1 / refs:` 格式和旧版平铺格式。桥不会为其他 provider 自动读取个人 DeepSeek key。`apiKeyEnv: false` 表示认证完全交给 DSH，不由桥读取或注入 key。

所有连接均可设置以下字段，也可放在 JSON 顶层作为公共默认值：

| 字段 | 用途 |
|---|---|
| `command` | DSH 可执行文件或 PATH 命令名；不要附带命令行参数 |
| `home` | 此连接的 DSH home；隔离设置、凭据与会话 |
| `profile` | SDK profile，默认 `sdk`；自定义 profile 必须保留 DSH JSON-RPC server |
| `cwd` | 默认工作目录；未设置则用 MCP server 的 cwd |
| `provider` / `model` | DSH 注册的提供商路由与模型 id |
| `baseURL` | `deepseek-official` adapter 的 API 地址 |
| `apiKeyEnv` | 凭据引用名称；其他 adapter 可通过自己的补丁引用相同名称 |
| `patches` | 按顺序传入 DSH `--patch` 的配置文件数组 |
| `reasoningEffort` / `maxTokens` | SDK 初始化的推理强度与 token 上限 |
| `env` | 子进程环境变量；字符串设置值，`null` 删除继承值 |

路径相对于配置文件目录解析，支持 `~`、`${VAR}` 和 `%VAR%`。`env` 的字符串也支持变量展开；变量缺失会报错。顶层和连接的 `env` 合并，同名变量由连接覆盖；连接的 `patches` 数组替换公共数组。未声明的字段、无效连接或显式缺失的配置文件会直接报错。

使用其他 DSH provider 时，通过 `patches` 注册或配置相应 adapter，再设置其 `provider` 和 `model`；桥不会把所有提供商都转换成 DeepSeek 请求。桌面 profile 的补丁不会自动套用到 SDK；应提取其中的提供商配置到独立补丁，或直接使用本桥的原生 DeepSeek 地址与凭据字段。

选择顺序：调用参数 > `DSH_MCP_*` 环境变量 > 连接配置 > 公共配置 > DSH 设置与内置默认值。DSH home 依次使用 `DSH_MCP_HOME`、连接/公共 `home`、`DSH_HOME`、`~/.dsh`。

| 环境变量 | 用途 |
|---|---|
| `DSH_MCP_CONFIG` | 桥 JSON 配置文件 |
| `DSH_MCP_CONNECTION` | 默认连接名称 |
| `DSH_MCP_DSH_COMMAND` | 启动器 |
| `DSH_MCP_HOME` / `DSH_HOME` | DSH home |
| `DSH_MCP_PROFILE` / `DSH_MCP_CWD` | SDK profile / 默认工作目录 |
| `DSH_MCP_PROVIDER` / `DSH_MCP_MODEL` | 模型路由 |
| `DSH_MCP_BASE_URL` / `DSH_MCP_API_KEY_ENV` | 原生 DeepSeek 地址 / 凭据引用名称 |
| `DSH_MCP_REASONING_EFFORT` | 推理强度 |
| `DSH_MCP_DEBUG` | `1` 输出子进程日志 |
| `DSH_MCP_STATUS_DIR` | 覆盖状态发布目录；默认 `$DSH_HOME/storages/dsh-run-monitor` |
| `DSH_MCP_STATUS_DISABLED` | `1`/`true` 关闭状态发布 |
| `DSH_MCP_STATUS_HEARTBEAT_MS` | 运行中心跳间隔，默认 5000，范围 1000–60000 |
| `DSH_MCP_STATUS_STALE_MS` | 面板判定过期阈值，默认心跳的 3 倍 |

DSH 自身的 `DSH_PERMISSION_MODE` 等变量也会传给子进程。桥的默认权限是 `danger-full-access`（审批策略 `never`），可用 `DSH_PERMISSION_MODE` 显式覆盖，例如 `workspace-write`；`dsh_info.permissionMode` 和每个 runtime 的 `permissionMode` 可用于核验。个人 API key 与桌面账号登录态是两种认证方式；账号登录需要所选 SDK profile 本身具备对应的 account adapter，桥不转换登录 token。

## 接到 Codex

在项目目录运行，PowerShell 示例会自动得到源码的绝对路径：

```powershell
codex mcp add dsh -- node (Join-Path (Get-Location) 'src/server.mjs')
codex mcp get dsh
```

stdio 使用标准输出传 MCP 消息，启动日志写到标准错误。MCP 配置还可通过客户端的环境变量选项设置 `DSH_MCP_CONFIG` 或 `DSH_MCP_CONNECTION`。更改安装位置后更新客户端启动路径。

## 工具

| 工具 | 作用 |
|---|---|
| `dsh_info` | 查看连接名称、启动配置、凭据是否可用、状态发布文件与运行状态，不显示 key |
| `dsh_start` | 投任务，立即返回 `sessionId` |
| `dsh_wait` | 等当前 turn，最多 30 秒，可重复调用 |
| `dsh_run` | 投任务并等到完成，适合短任务 |
| `dsh_get` | 读取当前状态和最后输出 |
| `dsh_sessions` | 列出本进程启动过的会话 |
| `dsh_shutdown` | 停掉本桥启动的 SDK runtime |

`dsh_info`、`dsh_start`、`dsh_run` 接受可选 `connection`。后两者还可覆盖 `provider`、`model` 和 `cwd`，并可传 `title`（1–120 字符）作为任务卡片标题；未提供时取任务开头的短句。

```text
dsh_info { connection: "company" }
dsh_run { connection: "company", task: "Reply with BRIDGE_OK. Do not use tools." }
dsh_start { connection: "personal", task: "实现 X 并跑测试" }
dsh_start { title: "实现只读会话详情页", task: "具体实现要求…", cwd: "D:/workspace/example-repo" }
dsh_wait { sessionId: "session-…" }
```

续聊传入原 `sessionId`；桥进程内的续聊固定使用原连接和工作目录，拒绝切换。同一 session 同时只能有一个 run。不同连接与启动参数使用独立 runtime；修改 DSH 外部补丁后重启桥以加载变化。

## 状态与用量

`dsh_start` / `dsh_wait` / `dsh_run` / `dsh_get` 返回同一套视图，`dsh_info` 和 `dsh_sessions` 的 `runs` 给出其摘要：

| 字段 | 含义 |
|---|---|
| `status` | `running`、`succeeded`、`error`、`interrupted`、`stopped`、`incomplete` |
| `isRunning` | 是否仍在执行 |
| `statusLine` | 单行中文摘要，可直接展示；含状态、用时、step、当前工具、已上报 token、最近活动 |
| `startedAt` / `finishedAt` / `durationMs` | 起点优先用 `turn/start` 事件时间，终点用 `turn/end`；结束后冻结且 clamp 到非负 |
| `currentStep` | `{ turn, step, startedAt, elapsedMs }` 或 `null` |
| `currentTool` / `currentTools` | 当前尚未返回结果的工具；并发工具在数组中 |
| `toolCalls` | 本 run 的工具调用历史，`tool/result.data.message.toolCallId` 配对，`message.isError` 判错 |
| `lastEvent` / `lastEventAgeMs` | 最近事件类型、时间和距今毫秒数 |
| `lastEventType` / `silentForMs` | 最近事件类型的快捷字段和静默时长 |
| `usage` | provider 上报的累计；没有样本时为 `null` |
| `usageUnavailableReason` | `usage === null` 时的明确原因 |

`usage` 的语义：

```json
{
  "scope": "run",
  "source": "provider",
  "final": true,
  "complete": true,
  "partial": false,
  "countedSamples": 2,
  "attempts": 2,
  "steps": 2,
  "expectedSteps": 2,
  "stepsWithUsage": 2,
  "expectedAttempts": 2,
  "attemptsWithUsage": 2,
  "invalidSamples": 0,
  "missingBuckets": [],
  "missingUsageSteps": [],
  "missingUsageAttempts": [],
  "missingBoundaries": [],
  "uncachedInputTokens": 5504,
  "cacheReadTokens": 17536,
  "cacheWriteTokens": 0,
  "outputTokens": 908,
  "totalTokens": 23948,
  "lastSample": { "turn": 1, "step": 2, "totalTokens": 12028 },
  "note": "provider-reported total for this finished run"
}
```

- `assistant/message.data.usage`（或 `assistant/message` / `assistant/attempt` 的 `data.stream` 中最后一个 usage chunk）才是 provider 上报值；`step/end` 没有 usage。
- 同一 `(turn, step)` attempt 的重复样本替换旧值；`llm/retry-started` 关闭替换槽，重试作为新的计费 attempt 累加。
- `scope` 固定为本轮 `run`：只统计该次 prompt 之后的事件，`resumedHistoryIncluded: false`，不伪造续聊前的历史累计。
- 只统计主会话；`includesSubagents: false`。运行中 `final: false`，只声称“已上报样本的累计”。
- `complete: true` 要求：已到 `turn/end`、每个已结束 step 都至少有一个可归一化 usage 样本、每个重试 attempt 也都有可归一化 usage、step/start/end 边界齐全、四桶已知、且没有非法样本。缺少 usage 的 step/attempt 分别记录在 `missingUsageSteps` / `missingUsageAttempts`，缺边界记录在 `missingBoundaries`；此时 `complete: false`、`partial: true`，不会把部分样本说成完整总量。
- 单样本与累计加法都检查 `Number.isSafeInteger`；无法精确表示时 `usage: null` + `usageUnavailableReason`，不输出丢精度的 token 数。单个样本非法会计入 `invalidSamples`。
- 缓存桶缺失时汇总 `cacheReadTokens`/`cacheWriteTokens` 为 `null`，不是 0；完全缺失 usage 时 `usage` 为 `null` 并给出原因，不能用字符数或上下文窗口冒充 token。

## 状态发布与 DSH 面板插件

桥在首次执行任务时，将脱敏的紧凑状态发布到 `$DSH_HOME/storages/dsh-run-monitor/bridge-<pid>-<id>.json`，从未执行任务的连接不创建空文件。每个桥进程一个文件，先写临时文件再原子 rename。运行中约每 5 秒心跳，空闲时停止重写；正常退出写 `stopped`。进程崩溃后心跳停止，面板按文件里的 `staleAfterMs` 显示“状态已过期”。宿主会把确认进程退出且超过宽限期的快照移入同目录 `archive/`，任务历史继续保留。

运行中的 `durationMs`、`lastEventAgeMs`、当前 step/工具的 `elapsedMs` 会在每次心跳发布和面板读取时按 `startedAt` / `lastEvent.time` 重新投影，即使长时间执行期间没有新事件，用时和“最近活动”也会继续走；`statusLine` 同步重建。终态和过期/停止态保持冻结，不再外推增长。

状态文件只含任务短标题和指标：桥/实例 id、pid、版本、状态、心跳；任务的 sessionId、cwd、provider/model、状态、时间、用时、当前 step/工具名、最近事件、脱敏 usage 汇总。**不含**完整任务正文、助手正文、工具参数、工具结果或凭据。会话正文通过另一个按任务授权的只读方法按需读取。

安装独立面板插件（只应在审查通过后对正式 profile 执行）：

```powershell
node scripts/install-run-monitor.mjs --dsh-home "$env:DSH_HOME" --dry-run
node scripts/install-run-monitor.mjs --dsh-home "$env:DSH_HOME"
# 撤销：只移除本插件的链接和 patch 条目，保留其他插件与设置
node scripts/install-run-monitor.mjs --dsh-home "$env:DSH_HOME" --uninstall
```

- 默认接入 `web,desktop` profile；`--profile web` 可只改一个。
- 源包默认 junction；`--copy` 使用受控拷贝。
- 改动 `cordis.patch.yml` 前写 `.bak-dsh-run-monitor-<时间>` 备份；重复运行不重复插入、不重复备份。
- 脚本不会杀进程或重启服务；需要手动重启/重载 DSH host 后插件才生效。
- 面板通过 DSH 已认证的 `POST /api/dsh-run-monitor` Connection endpoint 读取，不新开端口。支持空态、加载/读取错误、状态过期、多桥文件、损坏/超大文件；面板注册为 conversation 的 View 标签（与 Chat、Trajectory 并列），没有侧边栏入口和浮层；请求有 6 秒 AbortController 超时，卸载时中止并清理定时器；读取失败时缓存任务会标记为“状态已过期或连接中断”，不会继续显示为实时运行。运行中 3 秒轮询，空闲 15 秒，隐藏页 30 秒。结束任务的用时来自发布的 `durationMs`，不会继续增长。
- 若把桥的 `DSH_MCP_STATUS_DIR` 改到非默认目录，DSH host 进程也要能读到同一目录：给它设置相同的 `DSH_MCP_STATUS_DIR`（或 `DSH_MONITOR_STATUS_DIR`/插件 `statusDir`）。默认两边都解析 `$DSH_HOME/storages/dsh-run-monitor`，无需额外配置。

## 验证与限制

「DSH 任务」默认显示 agent 卡片概览，通过「进行中」「异常任务」「已结束」切换，支持搜索、模型筛选和任务详情。「连接管理」为独立页面，返回时保留筛选和选中任务。启用新增归档逻辑需重载 DSH 插件后端，并重启 MCP bridge 使首次任务前不写空文件的规则生效。详情及会话正文入口的接入说明见 [插件文档](plugins/dsh-run-monitor/README.md#任务概览)。

点击任务卡片进入只读会话大页面，查看任务指令、助手回复和可展开的工具执行过程；运行指标另设页签，输入在查看期间禁用。会话接口需重载 DSH 插件后端，新 `title` 参数需重启 MCP bridge 后重新发现工具 schema。

```sh
node --test --test-name-pattern="task titles" test/manager.test.mjs  # 例：仅定向检查任务标题
pnpm test           # 全量回归，仅在用户明确要求时运行
pnpm run test:smoke  # 一次真实 API 回复，并核验面板状态文件
```

日常修改只做简单定向测试，选取本次改动直接涉及的少量场景，通过即收尾；不默认运行全量、不反复扩大测试范围。会话页优先检查打开/返回、只读、消息与工具显示；标题修改只检查标题传递和展示。

默认测试无需真实 API，保留核心行为与安装安全检查；界面通过实际加载验收。`test:smoke` 使用当前连接调用一次模型并核验面板状态发布，会产生一次提供商调用费用。通过 `DSH_MCP_TEST_CWD` 可指定测试工作目录。

SDK 没有 per-turn cancel；`dsh_shutdown` 停止本桥启动的 runtime。SDK 会话不会出现在桌面窗口中；面板展示的是这些 SDK 任务，不是桌面当前聊天。长任务推荐 `dsh_start` + `dsh_wait`；客户端自行设置足够的 MCP 请求超时。

- `usage` 只覆盖本 run 的 provider 上报值；子代理、续聊前历史、字符启发式估算都不计入。
- 任务实时状态依赖心跳；旧快照归档还会确认 PID 已退出，并保留存活或无法确认的进程记录。归档不删除 SDK 会话及正文。
- 修改桥源码后需要重启 MCP server；`dsh_shutdown` 只重启 SDK runtime，不会重新加载桥源码。完整权限允许任务读写工作区外文件和执行命令，请仅向桥提交已授权的任务。

## License

MIT
