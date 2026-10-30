# dsh-run-monitor

DSH 侧边栏面板，展示由 `dsh-mcp-bridge` 通过 SDK profile 运行的任务。

数据流：

```text
dsh-mcp-bridge（SDK profile 子进程）
  └─ 原子写入 $DSH_HOME/storages/dsh-run-monitor/bridge-<pid>-<id>.json
       └─ dsh-run-monitor host（本 DSH 进程）
            └─ 认证 Connection endpoint POST /api/dsh-run-monitor
                 └─ web/desktop sidebar.footer.action 面板
```

- 不新开端口；读取走 DSH 已认证的 Connection fetch registry。
- 状态文件只含脱敏字段：任务/桥 id、cwd、provider/model、状态、用时、当前工具名、事件类型/时间、脱敏 token 汇总；不含提示词、工具参数、工具结果、助手正文或凭据。
- 每个桥进程一个文件；运行中约每 5 秒心跳，空闲时停止重写，正常退出写 `stopped`。崩溃后心跳停止，面板按 `staleAfterMs` 显示“状态已过期”，不会永久显示运行中。
- 运行中的用时、最近活动年龄和 step/工具 elapsed 在每次心跳/读取时按时间重新投影；终态与过期/停止态冻结，不再增长。`statusLine` 同步重建。
- 状态目录默认 `$DSH_HOME/storages/dsh-run-monitor`；桥与 host 用同一默认值。若桥设置了 `DSH_MCP_STATUS_DIR`，DSH host 进程也需要同样的 `DSH_MCP_STATUS_DIR`（或 `DSH_MONITOR_STATUS_DIR`/插件 `statusDir`）才能读到自定义目录。
- toggle 留在 sidebar.footer.action 槽内，仅 popup 通过 portal 挂到 body；fetch 有 6 秒 AbortController 超时，卸载会 abort 并清理定时器；读取失败时缓存任务显示“状态已过期或连接中断”，不会继续显示为实时运行。
- 多桥发现按文件 mtime 从新到旧有界选取，旧文件积累不会挤掉最新活跃桥。隐藏页把轮询间隔降到 30 秒；运行中 3 秒；空闲 15 秒。
- 已完成任务的用时来自发布的 `durationMs`，不会继续增长。

安装见桥仓库 `README.md` 的“DSH 面板插件”一节；`scripts/install-run-monitor.mjs` 支持安装、重复运行和撤销。
