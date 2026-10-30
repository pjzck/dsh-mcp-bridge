# dsh-mcp-bridge

把 DeepSeek Harness 暴露成一个 MCP server，让 Codex 或其他 MCP 客户端把任务交给 DSH 执行。

```text
MCP client → dsh-mcp-bridge → dsh --profile sdk → DSH agent → workspace
```

桥只负责建会话、投任务、等结果；规划、读写文件、跑命令都由 DSH 自己的 agent 完成。它使用 DSH 官方 SDK profile，不修改桌面端，也不是 DSH 插件。

## 要求

- DSH Desktop 已安装，且 `dsh` 命令可用
- Node.js 22+
- `DEEPSEEK_API_KEY`：放在环境变量，或留在 `$DSH_HOME/.credentials.yaml`（桥会自动读取）

## 安装

```sh
git clone https://github.com/pjzck/dsh-mcp-bridge.git
cd dsh-mcp-bridge
npm install
npm run test:smoke
```

## 接到 Codex

```sh
codex mcp add dsh -- node "H:\path\to\dsh-mcp-bridge\src\server.mjs"
```

或写进 `~/.codex/config.toml`：

```toml
[mcp_servers.dsh]
command = "node"
args = ["H:\\path\\to\\dsh-mcp-bridge\\src\\server.mjs"]
```

首次调用 MCP 工具时 Codex 会要求审批，允许即可。非交互的 `codex exec` 默认拒绝 MCP 工具，自动化场景请加 `--approve-for-me`。

## 工具

| 工具 | 作用 |
|---|---|
| `dsh_info` | 查看 dsh 命令、模型、API key、状态发布文件和运行中的会话 |
| `dsh_start` | 投任务，立即返回 `sessionId` |
| `dsh_wait` | 等当前 turn，最多 30 秒，可重复调用 |
| `dsh_run` | 投任务并等到完成，适合短任务 |
| `dsh_get` | 读取当前状态和最后输出 |
| `dsh_sessions` | 列出本进程启动过的会话 |
| `dsh_shutdown` | 停掉 SDK runtime |

典型用法：

```text
dsh_info
dsh_start { task: "实现 X 并跑测试", cwd: "H:\\repo" }
dsh_wait  { sessionId: "session-…" }
```

续聊时把上次的 `sessionId` 传给 `dsh_start`。

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

桥会把脱敏的紧凑状态发布到 `$DSH_HOME/storages/dsh-run-monitor/bridge-<pid>-<id>.json`，每个桥进程一个文件，先写临时文件再原子 rename。运行中约每 5 秒心跳，空闲时停止重写；正常退出写 `stopped`。进程崩溃后心跳停止，面板按文件里的 `staleAfterMs` 显示“状态已过期”，不会把旧文件永远显示为运行中。桥不会扫描或删除其他桥的文件。

运行中的 `durationMs`、`lastEventAgeMs`、当前 step/工具的 `elapsedMs` 会在每次心跳发布和面板读取时按 `startedAt` / `lastEvent.time` 重新投影，即使长时间执行期间没有新事件，用时和“最近活动”也会继续走；`statusLine` 同步重建。终态和过期/停止态保持冻结，不再外推增长。

状态文件只含：桥/实例 id、pid、版本、状态、心跳；任务的 sessionId、cwd、provider/model、状态、时间、用时、当前 step/工具名、最近事件、脱敏 usage 汇总。**不含**提示词、助手正文、工具参数、工具结果、凭据。

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
- 面板通过 DSH 已认证的 `POST /api/dsh-run-monitor` Connection endpoint 读取，不新开端口。支持空态、加载/读取错误、状态过期、多桥文件、损坏/超大文件；toggle 留在 sidebar footer 槽内，仅 popup portal 到 body；请求有 6 秒 AbortController 超时，卸载时中止并清理定时器；读取失败时缓存任务会标记为“状态已过期或连接中断”，不会继续显示为实时运行。运行中 3 秒轮询，空闲 15 秒，隐藏页 30 秒。结束任务的用时来自发布的 `durationMs`，不会继续增长。
- 若把桥的 `DSH_MCP_STATUS_DIR` 改到非默认目录，DSH host 进程也要能读到同一目录：给它设置相同的 `DSH_MCP_STATUS_DIR`（或 `DSH_MONITOR_STATUS_DIR`/插件 `statusDir`）。默认两边都解析 `$DSH_HOME/storages/dsh-run-monitor`，无需额外配置。

## 配置

| 环境变量 | 说明 |
|---|---|
| `DSH_MCP_DSH_COMMAND` | dsh 可执行文件路径；默认用桌面端 `dsh.cmd` 或 PATH 上的 `dsh` |
| `DSH_MCP_PROVIDER` | 模型 provider；默认读 DSH settings |
| `DSH_MCP_MODEL` | 模型 id；默认读 DSH settings |
| `DEEPSEEK_API_KEY` | API key；默认读 `$DSH_HOME/.credentials.yaml` |
| `DSH_HOME` | DSH home，默认 `~/.dsh` |
| `DSH_PERMISSION_MODE` | DSH 权限模式，默认 `danger-full-access`（完整权限，审批策略 `never`）；显式设置可覆盖，例如 `workspace-write` |
| `DSH_MCP_DEBUG` | 设为 `1` 输出 SDK 子进程日志 |
| `DSH_MCP_STATUS_DIR` | 覆盖状态发布目录；默认 `$DSH_HOME/storages/dsh-run-monitor` |
| `DSH_MCP_STATUS_DISABLED` | `1`/`true` 关闭状态发布 |
| `DSH_MCP_STATUS_HEARTBEAT_MS` | 运行中心跳间隔，默认 5000，范围 1000–60000 |
| `DSH_MCP_STATUS_STALE_MS` | 面板判定过期阈值，默认心跳的 3 倍 |

权限默认值由桥在创建 SDK 子进程时传入，`dsh_info.permissionMode` 和每个 runtime 的 `permissionMode` 可用于核验。修改桥源码后需要重启 MCP server；`dsh_shutdown` 只重启 SDK runtime，不会重新加载桥源码。完整权限允许任务读写工作区外文件和执行命令，请仅向桥提交已授权的任务。

## 测试

```sh
npm test          # 纯 node:test：状态归约、manager、发布器、插件、安装脚本
npm run test:smoke  # 真实 API 的 MCP smoke，费用较高
npm run test:e2e    # 新进程 MCP 端到端：运行中状态、真实 token、文件核验、计时冻结
```

插件自身的测试在 `plugins/dsh-run-monitor/test/`，对真实 `lib/client.js` bundle 用最小 hooks/timers harness 驱动，不做源码字符串匹配。

## 限制

- SDK 协议没有 per-turn cancel；只能 `dsh_shutdown` 停 runtime。
- 会话在独立的 SDK runtime 里，不会出现在桌面端窗口中；面板展示的是这些 SDK 任务，不是桌面当前聊天。
- 需要 API key；SDK profile 不使用桌面登录态。
- 同一个 `sessionId` 同时只能有一个进行中的 run。
- `usage` 只覆盖本 run 的 provider 上报值；子代理、续聊前历史、字符启发式估算都不计入。
- 崩溃的桥只靠心跳过期识别；面板不会删除旧文件，也不会修改其他桥的数据。

## License

MIT
