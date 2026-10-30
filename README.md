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

DSH 自身的 `DSH_PERMISSION_MODE` 等变量也会传给子进程。个人 API key 与桌面账号登录态是两种认证方式；账号登录需要所选 SDK profile 本身具备对应的 account adapter，桥不转换登录 token。

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
| `dsh_info` | 查看连接名称、启动配置、凭据是否可用与运行状态，不显示 key |
| `dsh_start` | 投任务，立即返回 `sessionId` |
| `dsh_wait` | 等当前 turn，最多 30 秒，可重复调用 |
| `dsh_run` | 投任务并等到完成，适合短任务 |
| `dsh_get` | 读取当前状态和最后输出 |
| `dsh_sessions` | 列出本进程启动过的会话 |
| `dsh_shutdown` | 停掉本桥启动的 SDK runtime |

`dsh_info`、`dsh_start`、`dsh_run` 接受可选 `connection`。后两者还可覆盖 `provider`、`model` 和 `cwd`。

```text
dsh_info { connection: "company" }
dsh_run { connection: "company", task: "Reply with BRIDGE_OK. Do not use tools." }
dsh_start { connection: "personal", task: "实现 X 并跑测试" }
dsh_wait { sessionId: "session-…" }
```

续聊传入原 `sessionId`；桥进程内的续聊固定使用原连接和工作目录，拒绝切换。同一 session 同时只能有一个 run。不同连接与启动参数使用独立 runtime；修改 DSH 外部补丁后重启桥以加载变化。

## 验证与限制

```sh
pnpm test
pnpm run test:smoke
```

单元与进程测试无需真实 API。`test:smoke` 使用当前连接实际调用模型，验证回复、续聊和 workspace 内写文件，会产生提供商调用费用。通过 `DSH_MCP_TEST_CWD` 可指定测试工作目录。

SDK 没有 per-turn cancel；`dsh_shutdown` 停止本桥启动的 runtime。SDK 会话不会出现在桌面窗口中。长任务推荐 `dsh_start` + `dsh_wait`；客户端自行设置足够的 MCP 请求超时。

## License

MIT
