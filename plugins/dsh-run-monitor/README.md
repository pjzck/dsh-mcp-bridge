# dsh-run-monitor

DSH 会话页的「DSH 任务」概览，展示由 `dsh-mcp-bridge` 通过 SDK profile 运行的任务。

数据流：

```text
dsh-mcp-bridge（SDK profile 子进程）
  └─ 原子写入 $DSH_HOME/storages/dsh-run-monitor/bridge-<pid>-<id>.json
       └─ dsh-run-monitor host（本 DSH 进程）
            └─ 认证 Connection endpoint POST /api/dsh-run-monitor
                 └─ web/desktop conversation.view 视图
```

- 不新开端口；读取走 DSH 已认证的 Connection fetch registry。
- 状态文件只含脱敏字段：任务/桥 id、cwd、provider/model、状态、用时、当前工具名、事件类型/时间、脱敏 token 汇总；不含提示词、工具参数、工具结果、助手正文或凭据。
- 每个桥进程一个文件；运行中约每 5 秒心跳，空闲时停止重写，正常退出写 `stopped`。崩溃后心跳停止，面板按 `staleAfterMs` 显示“状态已过期”，不会永久显示运行中。
- 运行中的用时、最近活动年龄和 step/工具 elapsed 在每次心跳/读取时按时间重新投影；终态与过期/停止态冻结，不再增长。`statusLine` 同步重建。
- 状态目录默认 `$DSH_HOME/storages/dsh-run-monitor`；桥与 host 用同一默认值。若桥设置了 `DSH_MCP_STATUS_DIR`，DSH host 进程也需要同样的 `DSH_MCP_STATUS_DIR`（或 `DSH_MONITOR_STATUS_DIR`/插件 `statusDir`）才能读到自定义目录。
- 面板注册为 conversation 的视图条目（会话头部 View 标签，与 Chat、Trajectory 并列），不再有侧边栏入口和浮层；fetch 有 6 秒 AbortController 超时，卸载会 abort 并清理定时器；读取失败时缓存任务显示“状态已过期或连接中断”，不会继续显示为实时运行。
- 多桥发现按文件 mtime 从新到旧有界选取，旧文件积累不会挤掉最新活跃桥。隐藏页把轮询间隔降到 30 秒；运行中 3 秒；空闲 15 秒。
- 已完成任务的用时来自发布的 `durationMs`，不会继续增长。

## 任务概览

- 顶部显示运行、排队、需关注任务数，以及当前筛选列表的已上报 token 累计。
- 默认只展示活跃任务，以自适应网格呈现；失败、中断、过期任务可在「需关注」查看；所有非活跃任务可在「历史记录」查看。无任务的 bridge 只出现在底部折叠的连接信息中。
- 支持工作区、会话 ID、提供商、模型、桥 ID 搜索与模型筛选；每次先渲染 30 张卡片，可分批加载更多。
- 卡片显示当前工具、turn/step、已完成步骤、用时、最近活动、token 与上下文窗口；点击查看详情中的用量分桶、完整会话标识及连接信息。
- 步骤没有已知总数，因此不显示完成百分比。`progress.completedSteps` 只计入实际 `step/end`；`toolCalls` / `completedToolCalls` 为保留的近期工具历史数与其中成功数。
- `contextWindow` 来自官方 `request/context`，切换到未声明窗口的模型会清空旧值。当前没有可靠的上下文占用投影，明确显示「占用量未上报」，不用累计 token 推算。
- 一张卡片代表一个 bridge 的一个 SDK 会话当前 run；不同桥的同名 session 不会合并，内部子代理不另行计数。token 仍遵循当前 run 的 provider 上报口径。

详情组件预留 `onOpenSession({ sessionId, bridgeInstanceId, cwd })` 回调。当前注册没有注入此回调，「打开会话」显示禁用与未接入说明；后续可在注册处绑定真实 SDK 会话查看能力，无需改动卡片布局。该入口不猜测桌面聊天路由，也不从状态文件读取会话正文。

前端源文件通过现有插件加载机制更新；新增 publisher 字段需要重启 MCP bridge 进程后才会由新任务发布，`dsh_shutdown` 只重启其 SDK runtime。

扩展接口参考官方 [slot 注册表](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-slots/README.zh.md)、[conversation 实现](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-conversation)与[插件打包说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)。信息层级参考 [Langfuse 概览与 trace 详情](https://langfuse.com/docs/observability/overview)。

安装见桥仓库 `README.md` 的“DSH 面板插件”一节；`scripts/install-run-monitor.mjs` 支持安装、重复运行和撤销。
