# dsh-mcp-bridge

让 **Codex（或任意 MCP 客户端）** 通过 DSH 官方的 `dsh --profile sdk` 把任务交给 DeepSeek Harness 执行的一个薄桥。

```text
MCP client (Codex / Claude / script)
        │  stdio MCP
        ▼
  dsh-mcp-bridge
        │  JSON-RPC over stdio（官方 SDK profile）
        ▼
  dsh --profile sdk
        │  自己的 tools / sandbox / session
        ▼
     workspace
```

它不是 DSH 插件，不修改桌面端安装，也不依赖第三方插件：只使用 DSH 官方的 SDK profile。DSH 侧仍然是完整的 agent（规划、读写文件、跑命令、开子 agent），桥只负责“建会话 / 投任务 / 等结果”。

## 为什么不用现成插件

- 官方 DSH 只有 **MCP client**（`dsh-mcp-client` / `dsh-mcp-resources`），没有官方 MCP Server。
- 第三方 `dsh-as-mcp` 是 in-host 插件，功能更全，但属于第三方代码，且装进桌面 profile 需要重启桌面端。
- 本项目走官方 SDK，代码量小、DSH 升级只需保持 `--profile sdk` 的线协议；适合“Codex 指挥 DSH 当执行子代理”。

代价：MCP 创建的会话是 **SDK runtime 里的独立会话**，不会出现在桌面端窗口里；它与桌面端共用 `$DSH_HOME` 的凭据、skills、settings 和会话存储。

## 前置条件

- DSH Desktop 已安装，且 `dsh` 命令可用（桌面端 0.2.1+；本项目实测 `0.2.1-rc.3`）。
- Node.js **22+**。
- `DEEPSEEK_API_KEY`：可以放在环境变量里，或留在 `$DSH_HOME/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`（桥会自动读取，值不会写日志、不回传）。
  - SDK profile 不走桌面登录态，所以必须有 API key；否则会报 `MISSING_CREDENTIAL`。

## 安装

```sh
git clone <this-repo> dsh-mcp-bridge
cd dsh-mcp-bridge
npm install
npm run test:smoke
```

`test:smoke` 会拉起一个真实的 `dsh --profile sdk`，做一轮 “回复 BRIDGE_OK” 和一轮带工具调用的任务；会消耗少量 API 额度。

## 接到 Codex

### 方式 A：Codex CLI

```sh
codex mcp add dsh -- node "H:\workspace\dsh-mcp-bridge\src\server.mjs"
```

如果 Codex 需要显式环境变量：

```sh
codex mcp add dsh --env DEEPSEEK_API_KEY=sk-... -- node "H:\...\src\server.mjs"
```

### 方式 B：`~/.codex/config.toml`

```toml
[mcp_servers.dsh]
command = "node"
args = ["H:\\workspace\\dsh-mcp-bridge\\src\\server.mjs"]
# env = { DEEPSEEK_API_KEY = "sk-..." }   # 可选；桥也会读 $DSH_HOME/.credentials.yaml
```

注册后新建 Codex 任务，先让它调用 `dsh_info`，再让它在目标仓库里调用 `dsh_run` / `dsh_start`。

## 工具

| 工具 | 用途 |
|---|---|
| `dsh_info` | 报告 dsh 命令、模型路由、API key 是否可见、运行中的 SDK runtime 和会话。排错先调它。 |
| `dsh_start` | 投一条任务，立即返回 `sessionId`；不传 `sessionId` 就是新会话，传已有 id 就是续聊。 |
| `dsh_wait` | 等当前 turn 最多 30 秒；返回 `status: "running"` 就再调一次。 |
| `dsh_run` | `start` + 等到完成；适合短任务。超时返回 `timedOut: true`，turn 仍在跑，可继续 `dsh_wait`。 |
| `dsh_get` | 不等待，直接读当前状态和最后一段 assistant 输出。 |
| `dsh_sessions` | 列出本 MCP 进程启动过的会话。 |
| `dsh_shutdown` | 停掉所有 SDK runtime。没有 per-turn cancel，停 runtime 会放弃正在跑的 turn；下次调用会重新拉起。 |

典型流程：

```text
dsh_info
dsh_start { task: "在这个仓库里实现 X，并跑测试", cwd: "H:\\repo" }
dsh_wait  { sessionId: "session-…" }          # 重复直到 status != running
dsh_get   { sessionId: "session-…" }          # 需要中途看进度时
```

续聊：

```text
dsh_start { task: "继续修上一个测试", cwd: "H:\\repo", sessionId: "session-…" }
```

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `DSH_MCP_DSH_COMMAND` | 桌面端 `dsh.cmd`，否则 PATH 上的 `dsh` | dsh 可执行文件路径。 |
| `DSH_MCP_PROVIDER` | 读 `$DSH_HOME/settings.yaml`，否则 `deepseek-official` | 模型 provider。 |
| `DSH_MCP_MODEL` | 读 settings，否则 `deepseek-flash` | 模型 id。 |
| `DEEPSEEK_API_KEY` | 读 `$DSH_HOME/.credentials.yaml` | SDK runtime 的凭据。 |
| `DSH_HOME` | `~/.dsh` | DSH home；桥和桌面端共用。 |
| `DSH_PERMISSION_MODE` | DSH 默认 `workspace-write` | 传给 DSH；需要全权时设 `danger-full-access`。 |
| `DSH_MCP_DEBUG` | 未设置 | `1` 时把 SDK 子进程 stderr 转发到桥的 stderr。 |

## 会话与限制

- **没有 per-turn cancel**：DSH SDK 协议没有 `session/cancel`。要中止只能 `dsh_shutdown` 停 runtime（会放弃该 runtime 的所有 turn）。
- **`dsh_run` 不是无限等**：默认 15 分钟；超时后 turn 继续跑，用 `dsh_wait` / `dsh_get` 继续观察。
- **会话不在桌面 UI**：这是独立 SDK 进程。若要“在桌面窗口里看 DSH 干活”，应使用 in-host 插件（如 `dsh-as-mcp`），而不是本项目。
- **一个 session 同时只能有一个 MCP run**：同一 `sessionId` 并发 `dsh_start` 会被拒绝；不同 session 可以并行。
- **workspace 只是起点**：DSH agent 仍受它自己的 sandbox / permission 策略约束；桥不额外加文件或 shell 工具。
- **模型路由固定在一个 runtime**：同一 `(cwd, provider, model)` 复用一个 runtime；换模型会开新 runtime。

## 安全

桥本身只是一个 stdio 进程，但它拉起的 `dsh --profile sdk` 拥有你给 DSH 的权限：能读写工作区、跑命令、访问网络。`DEEPSEEK_API_KEY` 只通过环境变量交给子进程，不写日志、不通过 MCP 返回。

## 开发

```text
src/config.mjs    # dsh 命令 / 模型 / 凭据解析
src/runtime.mjs   # 一个 dsh --profile sdk 子进程 + JSON-RPC
src/manager.mjs   # runtime 池、run 记录、start/wait/get
src/server.mjs    # MCP stdio server 与工具定义
test/smoke.mjs    # 真模型 + 真工具的端到端冒烟
```

```sh
npm run test:smoke
```

## License

MIT

