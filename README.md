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
| `dsh_info` | 查看 dsh 命令、模型、API key、运行中的会话 |
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

## 配置

| 环境变量 | 说明 |
|---|---|
| `DSH_MCP_DSH_COMMAND` | dsh 可执行文件路径；默认用桌面端 `dsh.cmd` 或 PATH 上的 `dsh` |
| `DSH_MCP_PROVIDER` | 模型 provider；默认读 DSH settings |
| `DSH_MCP_MODEL` | 模型 id；默认读 DSH settings |
| `DEEPSEEK_API_KEY` | API key；默认读 `$DSH_HOME/.credentials.yaml` |
| `DSH_HOME` | DSH home，默认 `~/.dsh` |
| `DSH_PERMISSION_MODE` | DSH 权限模式，默认 `workspace-write` |
| `DSH_MCP_DEBUG` | 设为 `1` 输出 SDK 子进程日志 |

## 限制

- SDK 协议没有 per-turn cancel；只能 `dsh_shutdown` 停 runtime。
- 会话在独立的 SDK runtime 里，不会出现在桌面端窗口中。
- 需要 API key；SDK profile 不使用桌面登录态。
- 同一个 `sessionId` 同时只能有一个进行中的 run。

## License

MIT
