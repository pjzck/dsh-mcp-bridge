window.__ModuleLoader__.load({
    id: "dsh-run-monitor",
    factory: (require) => {
        const React = require("react");
        const h = React.createElement;
        const API_PATH = "/api/dsh-run-monitor";
        const CSS = `
.drm-view{--drm-bg:var(--dsw-alias-bg-base,#fff);--drm-fg:var(--dsw-alias-label-primary,#20252f);--drm-muted:var(--dsw-alias-label-secondary,#7b808b);--drm-line:var(--dsw-alias-border-l3,rgba(128,128,128,.18));--drm-soft:rgba(128,128,128,.055);--drm-accent:#4d6bfe;display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0;overflow-y:auto;padding:24px 28px 32px;box-sizing:border-box;color:var(--drm-fg);font-size:13px;line-height:1.5;container-type:inline-size}
.drm-view *{box-sizing:border-box}.drm-view button,.drm-view input,.drm-view select{font:inherit;color:inherit}.drm-view button{cursor:pointer}.drm-view button:disabled{cursor:default;opacity:.55}.drm-view button:focus-visible,.drm-view input:focus-visible,.drm-view select:focus-visible,.drm-view summary:focus-visible{outline:2px solid var(--drm-accent);outline-offset:3px}.drm-view h2,.drm-view h3,.drm-view p{margin:0}.drm-muted{color:var(--drm-muted)}.drm-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.drm-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.drm-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.drm-heading{display:flex;align-items:center;gap:12px}.drm-logo{display:grid;place-items:center;width:38px;height:38px;border:1px solid rgba(77,107,254,.2);background:rgba(77,107,254,.07);border-radius:11px;color:var(--drm-accent)}.drm-view h2{font-size:20px;font-weight:650;letter-spacing:-.4px}.drm-subtitle{font-size:12px;color:var(--drm-muted);margin-top:2px!important}.drm-sync{display:flex;align-items:center;gap:10px;color:var(--drm-muted);font-size:11px}.drm-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}.drm-dot-live{color:#24946b;box-shadow:0 0 0 3px rgba(36,148,107,.09)}.drm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--drm-line);border-radius:7px;background:transparent;padding:6px 10px;font-size:12px!important;white-space:nowrap}.drm-btn:hover:not(:disabled){background:var(--drm-soft)}.drm-btn-primary{color:var(--drm-accent)!important;background:rgba(77,107,254,.06)}.drm-spin svg{animation:drm-spin 1s linear infinite}@keyframes drm-spin{to{transform:rotate(360deg)}}
.drm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:24px}.drm-stat{padding:16px 18px;border:1px solid var(--drm-line);border-radius:10px;background:var(--drm-soft);min-width:0}.drm-stat-label{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--drm-muted)}.drm-stat-value{display:block;margin-top:8px;font-size:28px;font-weight:600;line-height:1.2;letter-spacing:-.7px;font-variant-numeric:tabular-nums}.drm-stat-value small{font-size:12px;font-weight:400;letter-spacing:0;color:var(--drm-muted);margin-left:6px}.drm-stat-note{margin-top:5px;font-size:11px;color:var(--drm-muted)}.drm-blue{color:var(--drm-accent)}.drm-amber{color:#b98324}
.drm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}.drm-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--drm-line);border-radius:8px;background:var(--drm-soft)}.drm-tab{border:0;background:transparent;padding:5px 12px;border-radius:5px;font-size:12px!important;color:var(--drm-muted)!important;display:flex;align-items:center;gap:7px}.drm-tab[aria-pressed=true]{background:var(--drm-bg);color:var(--drm-fg)!important;box-shadow:0 1px 4px rgba(0,0,0,.07)}.drm-count{font:10px ui-monospace,Consolas,monospace;min-width:17px;padding:1px 4px;border-radius:4px;background:rgba(128,128,128,.1)}.drm-filters{display:flex;gap:8px;flex:1;justify-content:flex-end}.drm-search{display:flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid var(--drm-line);border-radius:7px;max-width:270px;min-width:110px;color:var(--drm-muted)}.drm-search input{min-width:0;width:100%;border:0;outline:0;background:transparent;font-size:12px!important}.drm-select{max-width:170px;border:1px solid var(--drm-line);border-radius:7px;background:var(--drm-bg);padding:5px 8px;font-size:12px!important}.drm-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:11px;color:var(--drm-muted)}
.drm-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}.drm-layout[data-detail=true]{grid-template-columns:minmax(0,1fr) 320px}.drm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr));gap:14px;align-items:start}.drm-card{display:flex;flex-direction:column;border:1px solid var(--drm-line);border-radius:11px;padding:17px;background:var(--drm-bg);text-align:left;width:100%;min-width:0;position:relative;transition:border-color .15s,box-shadow .15s}.drm-card:hover{border-color:rgba(77,107,254,.5);box-shadow:0 3px 12px rgba(0,0,0,.035)}.drm-card[aria-pressed=true]{border-color:var(--drm-accent);box-shadow:0 0 0 1px var(--drm-accent)}.drm-card[data-status=running]{border-top:2px solid var(--drm-accent);padding-top:16px}.drm-card[data-status=stale],.drm-card[data-status=error]{border-top:2px solid #b98324;padding-top:16px}.drm-card-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}.drm-agent-id{color:var(--drm-muted);font-size:10px}.drm-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 7px;border-radius:5px;background:var(--drm-soft);color:var(--drm-muted)}.drm-chip[data-status=running]{color:var(--drm-accent);background:rgba(77,107,254,.09)}.drm-chip[data-status=succeeded]{color:#24946b;background:rgba(36,148,107,.09)}.drm-chip[data-status=queued]{color:#9272cd;background:rgba(146,114,205,.09)}.drm-chip[data-status=error],.drm-chip[data-status=stale],.drm-chip[data-status=interrupted],.drm-chip[data-status=incomplete]{color:#b98324;background:rgba(185,131,36,.1)}.drm-card h3{font-size:15px;font-weight:600;letter-spacing:-.2px}.drm-model{margin-top:3px;font-size:11px;color:var(--drm-muted)}.drm-stage{display:flex;align-items:center;gap:7px;margin:16px 0 10px;font-size:11px;color:var(--drm-muted)}.drm-stage-line{height:2px;flex:1;background:var(--drm-line)}.drm-stage .drm-current{color:var(--drm-accent)}.drm-stage .drm-done{color:#24946b}.drm-activity{background:var(--drm-soft);border-radius:7px;padding:10px 11px;min-height:57px}.drm-activity-main{display:flex;justify-content:space-between;gap:8px;font-size:12px}.drm-activity-sub{margin-top:4px;font-size:10px;color:var(--drm-muted)}.drm-card-metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.drm-metric-label{display:block;font-size:10px;color:var(--drm-muted)}.drm-metric-value{display:block;margin-top:3px;font-size:15px;font-weight:550;font-variant-numeric:tabular-nums}.drm-metric-sub{display:block;margin-top:2px;font-size:10px;color:var(--drm-muted)}.drm-card-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:10px;border-top:1px solid var(--drm-line);color:var(--drm-muted);font-size:10px}.drm-card-link{display:inline-flex;align-items:center;gap:3px;color:var(--drm-accent)}
.drm-detail{position:sticky;top:0;max-height:70vh;overflow-y:auto;border:1px solid var(--drm-line);border-radius:11px;padding:18px;min-width:0;background:var(--drm-bg)}.drm-detail-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.drm-detail h3{font-size:14px;font-weight:600}.drm-detail-group{margin-top:18px;padding-top:15px;border-top:1px solid var(--drm-line)}.drm-detail-title{font-size:11px;font-weight:600;margin-bottom:10px;color:var(--drm-muted)}.drm-kv{display:flex;justify-content:space-between;gap:16px;font-size:11px;padding:4px 0}.drm-kv dt{color:var(--drm-muted);flex:none}.drm-kv dd{margin:0;text-align:right;overflow-wrap:anywhere;min-width:0}.drm-detail dl{margin:0}.drm-detail-id{display:block;overflow-wrap:anywhere;font-size:11px;padding:10px;background:var(--drm-soft);border-radius:6px;margin:10px 0;color:var(--drm-muted)}.drm-detail-note{font-size:11px;color:var(--drm-muted);margin-top:9px!important;overflow-wrap:anywhere}.drm-detail-group .drm-btn{width:100%;margin-top:8px}.drm-detail-head h3{white-space:nowrap}.drm-detail-head .drm-btn{flex:none}.drm-banner{border:1px solid rgba(185,131,36,.3);background:rgba(185,131,36,.06);border-radius:8px;padding:10px 13px;color:#b98324;font-size:12px;margin-bottom:16px;overflow-wrap:anywhere}.drm-empty{grid-column:1/-1;text-align:center;border:1px dashed var(--drm-line);border-radius:11px;padding:46px 20px;color:var(--drm-muted)}.drm-empty-icon{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--drm-soft);margin-bottom:12px}.drm-empty h3{font-size:14px;color:var(--drm-fg);margin-bottom:5px}.drm-empty p{font-size:12px}.drm-empty .drm-btn{margin-top:16px}.drm-connections{margin-top:20px;padding-top:12px;border-top:1px solid var(--drm-line);font-size:11px;color:var(--drm-muted)}.drm-connections summary{cursor:pointer}.drm-bridge-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--drm-line);overflow-wrap:anywhere}.drm-bridge-row:last-child{border:0}
@container(max-width:1050px){.drm-layout[data-detail=true]{grid-template-columns:minmax(0,1fr) 290px}.drm-stat{padding:14px}.drm-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr))}}
@container(max-width:760px){.drm-layout[data-detail=true]{grid-template-columns:minmax(0,1fr)}.drm-detail{position:static;grid-row:1}.drm-sync-label{display:none}.drm-stats{gap:8px}.drm-stat-value{font-size:24px}.drm-stat-note{font-size:10px}.drm-toolbar{align-items:stretch}.drm-filters{justify-content:stretch}.drm-search{flex:1;max-width:none}}
@container(max-width:640px){.drm-stats{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:16px}.drm-header{margin-bottom:16px}.drm-logo{display:none}.drm-view h2{font-size:18px}.drm-subtitle{font-size:11px}.drm-filters{flex-basis:100%}.drm-tabs{width:100%}.drm-tab{flex:1;justify-content:center;padding:5px 6px;gap:5px;white-space:nowrap}.drm-stat{padding:12px}.drm-stat-value{font-size:24px}}
@media(max-width:700px){.drm-view{padding:16px 14px 24px}}@media(prefers-reduced-motion:reduce){.drm-spin svg{animation:none}.drm-card{transition:none}}
`;
        const tagId = "dsh-run-monitor/dsh-run-monitor.css";
        if (typeof document !== "undefined") {
            let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
            if (!tag) {
                tag = document.createElement("style");
                tag.dataset.plugin = "dsh-run-monitor";
                tag.dataset.pluginCss = tagId;
                document.head.appendChild(tag);
            }
            tag.textContent = CSS;
        }
        function icon(name, size = 16) {
            const paths = { grid: "M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h6v6h-6z", refresh: "M20 7v5h-5 M4 17v-5h5 M6.1 6a8 8 0 0 1 13.3 3 M4.6 15A8 8 0 0 0 18 18", search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0", arrow: "M7 17L17 7 M7 7h10v10", close: "M6 6l12 12 M6 18L18 6", activity: "M2 12h4l3-8 6 16 3-8h4" };
            return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d: paths[name] || paths.grid }));
        }
        const labels = { running: "运行中", queued: "排队中", succeeded: "已完成", error: "失败", interrupted: "已中断", stopped: "已停止", incomplete: "未完整结束", stale: "连接中断", unknown: "未知" };
        const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
        function tokens(n, compact = false) { if (!isCount(n))
            return "未上报"; return compact && n >= 1000000 ? (n / 1000000).toFixed(2) + "M" : compact && n >= 1000 ? (n / 1000).toFixed(1) + "k" : n.toLocaleString("en-US"); }
        function duration(ms) { if (!Number.isFinite(ms) || ms < 0)
            return "—"; if (ms < 1000)
            return Math.round(ms) + "ms"; const s = Math.floor(ms / 1000); return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s" : Math.floor(s / 3600) + "h " + Math.floor(s % 3600 / 60) + "m"; }
        function age(ms) { return !Number.isFinite(ms) || ms < 0 ? "未知" : ms < 1000 ? "刚刚" : ms < 60000 ? Math.floor(ms / 1000) + " 秒前" : ms < 3600000 ? Math.floor(ms / 60000) + " 分钟前" : Math.floor(ms / 3600000) + " 小时前"; }
        function clock(value, date = false) { const d = new Date(value); return !value || Number.isNaN(d.getTime()) ? "—" : date ? d.toLocaleString("zh-CN", { hour12: false }) : d.toLocaleTimeString("zh-CN", { hour12: false }); }
        function workspace(path) { return typeof path === "string" && path ? path.split(/[\\/]+/).filter(Boolean).pop() || path : "未指定工作区"; }
        function shortId(id) { return typeof id === "string" ? id.replace(/^session-/, "").slice(0, 8) : "未知会话"; }
        function chip(status) { return h("span", { className: "drm-chip", "data-status": status }, h("span", { className: "drm-dot" }), labels[status] || labels.unknown); }
        function flatten(files, unavailable) {
            const entries = [];
            files.forEach((file, fi) => {
                if (!file || file.error)
                    return;
                const bridge = file.bridge || {};
                (Array.isArray(file.runs) ? file.runs : []).forEach((run, ri) => {
                    if (!run || typeof run !== "object")
                        return;
                    const claimedLive = run.isRunning === true || run.status === "running" || run.status === "queued";
                    const stale = unavailable || bridge.stale === true;
                    let status = run.status || "unknown";
                    if (claimedLive)
                        status = stale ? "stale" : bridge.state === "stopped" ? "stopped" : bridge.state !== "running" ? "incomplete" : run.status === "queued" ? "queued" : "running";
                    const live = status === "running" || status === "queued";
                    const attention = ["stale", "error", "interrupted", "incomplete", "unknown"].includes(status);
                    entries.push({ key: JSON.stringify([file.file || bridge.instanceId || fi, run.sessionId || ri]), run, bridge, status, live, stale, attention });
                });
            });
            return entries.sort((a, b) => Number(b.live) - Number(a.live) || (Date.parse(b.run.finishedAt || b.run.startedAt) || 0) - (Date.parse(a.run.finishedAt || a.run.startedAt) || 0) || a.key.localeCompare(b.key));
        }
        function phase(entry) {
            if (entry.status === "queued")
                return "等待执行";
            if (entry.status === "stale")
                return "心跳已过期，等待重新连接";
            if (!entry.live)
                return labels[entry.status] || labels.unknown;
            const tools = Array.isArray(entry.run.currentTools) ? entry.run.currentTools.map(t => t && t.name).filter(Boolean) : [];
            return tools.length ? "执行工具 · " + tools.join(" + ") : entry.run.currentStep ? "模型处理中" : "等待下一步事件";
        }
        function stepLabel(run) { return run.currentStep ? "Turn " + (run.currentStep.turn ?? "?") + " · Step " + (run.currentStep.step ?? "?") : isCount(run.currentTurn) ? "Turn " + run.currentTurn : "步骤未上报"; }
        function usageNote(usage) { return !usage ? "等待用量上报" : usage.partial === true || usage.complete === false ? "部分上报" : usage.final === true && usage.complete === true ? "本轮最终用量" : "本轮已上报"; }
        function metric(label, value, note, title) { return h("div", { title }, h("span", { className: "drm-metric-label" }, label), h("span", { className: "drm-metric-value" }, value), h("span", { className: "drm-metric-sub" }, note)); }
        function card(entry, selected, onSelect) {
            const { run, status, live, stale } = entry;
            const progress = run.progress;
            return h("button", { type: "button", className: "drm-card", "data-status": status, "aria-pressed": selected, "aria-label": "查看任务 " + workspace(run.cwd) + " " + shortId(run.sessionId), onClick: () => onSelect(entry.key), key: entry.key }, h("span", { className: "drm-card-top" }, chip(status), h("span", { className: "drm-agent-id drm-mono" }, "AGENT / " + shortId(run.sessionId))), h("h3", { className: "drm-truncate", title: run.cwd }, workspace(run.cwd)), h("span", { className: "drm-model drm-truncate", title: (run.provider || "") + " / " + (run.model || "") }, (run.provider || "未知提供商") + " / " + (run.model || "未知模型")), h("span", { className: "drm-stage", "aria-label": "执行阶段" }, h("span", { className: "drm-done" }, "已连接"), h("span", { className: "drm-stage-line" }), h("span", { className: live ? "drm-current" : "" }, status === "queued" ? "排队中" : live ? "执行中" : status === "stale" ? "连接中断" : "已执行"), h("span", { className: "drm-stage-line" }), h("span", { className: status === "succeeded" ? "drm-done" : "" }, status === "succeeded" ? "已完成" : live ? "待结束" : labels[status] || "已结束")), h("span", { className: "drm-activity" }, h("span", { className: "drm-activity-main" }, h("span", { className: "drm-truncate", title: phase(entry) }, phase(entry)), h("span", { className: "drm-mono" }, duration(run.durationMs))), h("span", { className: "drm-activity-sub" }, (live ? stepLabel(run) : progress && isCount(progress.completedSteps) ? "已完成 " + progress.completedSteps + " 个步骤" : "本轮执行已结束") + (live && progress && isCount(progress.completedSteps) ? " · 已完成 " + progress.completedSteps + " 步" : ""))), h("span", { className: "drm-card-metrics" }, metric("累计 token", tokens(run.usage?.totalTokens, true), usageNote(run.usage), tokens(run.usage?.totalTokens)), metric("上下文窗口", isCount(run.contextWindow) && run.contextWindow > 0 ? tokens(run.contextWindow, true) : "未上报", "占用量未上报")), h("span", { className: "drm-card-footer" }, h("span", null, stale ? "缓存快照 · 非实时" : live ? "活动于 " + age(run.lastEventAgeMs) : "结束于 " + clock(run.finishedAt)), h("span", { className: "drm-card-link" }, "查看详情", icon("arrow", 12))));
        }
        function kv(label, value) { return h("div", { className: "drm-kv", key: label }, h("dt", null, label), h("dd", null, value)); }
        // Separate integration seam: a future transcript opener receives an exact
        // bridge + SDK session identity. No desktop-chat route is inferred here.
        function detail(entry, onClose, onOpenSession) {
            const { run, bridge } = entry;
            const usage = run.usage;
            const target = { sessionId: run.sessionId, bridgeInstanceId: bridge.instanceId, cwd: run.cwd };
            return h("aside", { className: "drm-detail", "aria-label": "任务详情", onKeyDown: e => { if (e.key === "Escape")
                    onClose(); } }, h("div", { className: "drm-detail-head" }, h("h3", null, "任务详情"), h("button", { className: "drm-btn", type: "button", "aria-label": "关闭任务详情", onClick: onClose }, icon("close", 13))), chip(entry.status), h("h3", { style: { marginTop: 10 }, title: run.cwd }, workspace(run.cwd)), h("code", { className: "drm-detail-id" }, run.sessionId || "会话 ID 未上报"), h("dl", null, kv("模型", run.model || "未上报"), kv("用时", duration(run.durationMs)), kv("当前阶段", phase(entry)), kv("执行步骤", entry.live ? stepLabel(run) : "已结束"), kv("已完成步骤", tokens(run.progress?.completedSteps)), kv("近期工具成功 / 调用", isCount(run.progress?.completedToolCalls) && isCount(run.progress?.toolCalls) ? run.progress.completedToolCalls + " / " + run.progress.toolCalls : "未上报")), h("section", { className: "drm-detail-group" }, h("div", { className: "drm-detail-title" }, "TOKEN 用量 · 当前 RUN"), h("dl", null, kv("累计已上报", tokens(usage?.totalTokens)), kv("未缓存输入", tokens(usage?.uncachedInputTokens)), kv("缓存读取", tokens(usage?.cacheReadTokens)), kv("缓存写入", tokens(usage?.cacheWriteTokens)), kv("输出", tokens(usage?.outputTokens))), h("p", { className: "drm-detail-note" }, usageNote(usage) + "；不包含续聊前历史与内部子代理。")), h("section", { className: "drm-detail-group" }, h("div", { className: "drm-detail-title" }, "上下文"), h("dl", null, kv("窗口容量", isCount(run.contextWindow) && run.contextWindow > 0 ? tokens(run.contextWindow) : "未上报"), kv("当前占用", "未上报"))), h("section", { className: "drm-detail-group" }, h("div", { className: "drm-detail-title" }, "连接与时间"), h("dl", null, kv("工作目录", run.cwd || "—"), kv("桥实例", bridge.instanceId || "—"), kv("心跳", entry.stale ? "已过期 / 连接不可用" : age(bridge.heartbeatAgeMs)), kv("开始时间", clock(run.startedAt, true)), kv("结束时间", clock(run.finishedAt, true))), run.note ? h("p", { className: "drm-detail-note" }, run.note) : null), h("section", { className: "drm-detail-group" }, h("button", { type: "button", className: "drm-btn drm-btn-primary", disabled: typeof onOpenSession !== "function" || !run.sessionId, onClick: () => onOpenSession(target), title: typeof onOpenSession === "function" ? "打开此 SDK 会话" : "会话正文查看尚未接入" }, "打开会话", icon("arrow", 13)), h("p", { className: "drm-detail-note" }, typeof onOpenSession === "function" ? "打开此 SDK 会话的内容。" : "会话正文查看尚未接入，当前可查看运行详情。")));
        }
        function empty(title, message, action) { return h("div", { className: "drm-empty", role: "status" }, h("span", { className: "drm-empty-icon" }, icon("activity", 22)), h("h3", null, title), h("p", null, message), action); }
        function stat(label, value, note, tone, unit) { return h("div", { className: "drm-stat" }, h("div", { className: "drm-stat-label" }, h("span", { className: "drm-dot " + (tone || "") }), label), h("span", { className: "drm-stat-value " + (tone || "") }, value, unit ? h("small", null, unit) : null), h("div", { className: "drm-stat-note" }, note)); }
        function callApi(signal) {
            return fetch(API_PATH, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ method: "state" }), signal }).then(async (response) => {
                const result = await response.json().catch(() => null);
                if (!response.ok || result === null)
                    throw new Error("HTTP " + response.status);
                return result;
            });
        }
        function BridgeView(props = {}) {
            const [data, setData] = React.useState(null);
            const [error, setError] = React.useState(null);
            const [loading, setLoading] = React.useState(true);
            const [refreshing, setRefreshing] = React.useState(false);
            const [lastOkAt, setLastOkAt] = React.useState(null);
            const [scope, setScope] = React.useState("live");
            const [query, setQuery] = React.useState("");
            const [model, setModel] = React.useState("");
            const [selected, setSelected] = React.useState(null);
            const [limit, setLimit] = React.useState(30);
            const mounted = React.useRef(true), timer = React.useRef(), inFlight = React.useRef(false), running = React.useRef(false), abort = React.useRef(), load = React.useRef(), schedule = React.useRef();
            schedule.current = () => {
                clearTimeout(timer.current);
                timer.current = setTimeout(() => load.current(), document.hidden ? 30000 : running.current ? 3000 : 15000);
            };
            load.current = () => {
                if (inFlight.current)
                    return;
                inFlight.current = true;
                const controller = new AbortController();
                abort.current = controller;
                const timeout = setTimeout(() => controller.abort(), 6000);
                if (mounted.current)
                    setRefreshing(true);
                callApi(controller.signal).then(result => {
                    if (!mounted.current)
                        return;
                    if (!result?.ok || !result.value)
                        throw new Error(result?.error?.message || "状态读取失败");
                    setData(result.value);
                    setError(null);
                    setLastOkAt(Date.now());
                    running.current = flatten(Array.isArray(result.value.files) ? result.value.files : [], false).some(e => e.live);
                }).catch(e => {
                    if (mounted.current)
                        setError(controller.signal.aborted ? "状态请求超时或已取消" : String(e?.message || e));
                    running.current = false;
                }).finally(() => {
                    clearTimeout(timeout);
                    inFlight.current = false;
                    if (abort.current === controller)
                        abort.current = undefined;
                    if (!mounted.current)
                        return;
                    setLoading(false);
                    setRefreshing(false);
                    schedule.current();
                });
            };
            React.useEffect(() => {
                mounted.current = true;
                load.current();
                const onVisibility = () => { clearTimeout(timer.current); if (document.hidden)
                    schedule.current();
                else
                    load.current(); };
                document.addEventListener("visibilitychange", onVisibility);
                return () => { mounted.current = false; abort.current?.abort(); clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVisibility); };
            }, []);
            const files = data && Array.isArray(data.files) ? data.files : [];
            const entries = flatten(files, error !== null);
            const live = entries.filter(e => e.live), attention = entries.filter(e => e.attention), history = entries.filter(e => !e.live);
            const scoped = scope === "history" ? history : scope === "attention" ? attention : live;
            const normalized = query.trim().toLowerCase();
            const visible = scoped.filter(e => (!model || e.run.model === model) && (!normalized || [e.run.cwd, e.run.sessionId, e.run.provider, e.run.model, e.bridge.instanceId, labels[e.status]].join(" ").toLowerCase().includes(normalized)));
            const models = [...new Set(entries.map(e => e.run.model).filter(Boolean))].sort();
            const selectedEntry = entries.find(e => e.key === selected);
            const reported = visible.filter(e => isCount(e.run.usage?.totalTokens));
            const total = reported.reduce((sum, e) => sum + e.run.usage.totalTokens, 0);
            const totalKnown = reported.length > 0 && Number.isSafeInteger(total);
            const totalPartial = reported.length < visible.length || reported.some(e => e.run.usage.partial === true || e.run.usage.complete === false);
            const errors = files.filter(f => f?.error);
            const availableBridges = error ? 0 : files.filter(f => f?.bridge?.state === "running" && f.bridge.stale !== true).length;
            const changeScope = value => { setScope(value); setSelected(null); setLimit(30); };
            const reset = () => { setQuery(""); setModel(""); setSelected(null); setLimit(30); };
            const refresh = () => { clearTimeout(timer.current); load.current(); };
            return h("div", { className: "drm-view" }, h("header", { className: "drm-header" }, h("div", { className: "drm-heading" }, h("span", { className: "drm-logo" }, icon("grid", 20)), h("div", null, h("h2", null, "Agent 概览"), h("p", { className: "drm-subtitle" }, "DSH 任务 · 关注正在发生的事"))), h("div", { className: "drm-sync" }, h("span", { className: "drm-dot " + (error ? "drm-amber" : lastOkAt ? "drm-dot-live" : "") }), h("span", { className: "drm-sync-label" }, error ? "连接不可用" : lastOkAt ? "自动更新 · " + clock(lastOkAt) : "正在连接"), h("button", { type: "button", className: "drm-btn " + (refreshing ? "drm-spin" : ""), onClick: refresh, disabled: refreshing, "aria-label": "刷新任务状态" }, icon("refresh", 13), "刷新"))), error ? h("div", { className: "drm-banner", role: "alert" }, "读取失败：" + error + "。当前为上次快照，不计入实时运行数量。") : null, errors.length ? h("div", { className: "drm-banner", role: "alert" }, errors.length + " 个桥状态文件读取失败，可展开底部连接信息查看。") : null, h("section", { className: "drm-stats", "aria-label": "任务统计" }, stat("运行中", loading && !data ? "—" : live.filter(e => e.status === "running").length, "当前追踪的 SDK agent", "drm-blue"), stat("排队中", loading && !data ? "—" : live.filter(e => e.status === "queued").length, "已提交，等待执行"), stat("需关注", loading && !data ? "—" : attention.length, "失败、中断或连接过期", attention.length ? "drm-amber" : ""), stat("当前列表用量", totalKnown ? tokens(total, true) : "—", totalKnown ? totalPartial ? "已上报累计 · 数据不完整" : "当前 run 已上报累计" : "暂无已上报用量", "", totalKnown ? "tok" : "")), h("div", { className: "drm-toolbar" }, h("div", { className: "drm-tabs", role: "group", "aria-label": "任务视图" }, [["live", "活跃任务", live.length], ["attention", "需关注", attention.length], ["history", "历史记录", history.length]].map(([value, label, count]) => h("button", { type: "button", className: "drm-tab", "aria-pressed": scope === value, key: value, onClick: () => changeScope(value) }, label, h("span", { className: "drm-count" }, count)))), h("div", { className: "drm-filters" }, h("label", { className: "drm-search" }, icon("search", 14), h("input", { type: "search", value: query, onChange: e => { setQuery(e.target.value); setSelected(null); setLimit(30); }, placeholder: "搜索工作区、会话…", "aria-label": "搜索任务" })), h("select", { className: "drm-select", value: model, "aria-label": "筛选模型", onChange: e => { setModel(e.target.value); setSelected(null); setLimit(30); } }, h("option", { value: "" }, "全部模型"), models.map(m => h("option", { value: m, key: m }, m))))), h("div", { className: "drm-section-head" }, h("span", null, (scope === "live" ? "活跃任务" : scope === "attention" ? "需要关注的任务" : "已结束的任务") + " / " + visible.length), h("span", null, "按最近执行时间排序 · 点击卡片查看详情")), h("div", { className: "drm-layout", "data-detail": !!selectedEntry }, h("div", { className: "drm-grid", "aria-label": "任务卡片" }, loading && !data ? empty("正在读取任务", "连接 DSH bridge…") : visible.length ? visible.slice(0, limit).map(e => card(e, selected === e.key, setSelected)) : normalized || model ? empty("没有匹配的任务", "试试其他关键词或模型。", h("button", { className: "drm-btn", type: "button", onClick: reset }, "清除筛选")) : empty(scope === "live" ? "当前没有活跃任务" : scope === "attention" ? "暂无需要关注的任务" : "暂无历史记录", scope === "live" ? "新的 SDK 任务开始后会自动出现在这里。" : "任务状态会自动更新。", scope === "live" && history.length ? h("button", { className: "drm-btn", type: "button", onClick: () => changeScope("history") }, "查看 " + history.length + " 条历史记录") : null)), selectedEntry ? detail(selectedEntry, () => setSelected(null), props.onOpenSession) : null), visible.length > limit ? h("button", { type: "button", className: "drm-btn", style: { alignSelf: "center", marginTop: 16 }, onClick: () => setLimit(limit + 30) }, "加载更多 · 还有 " + (visible.length - limit) + " 个任务") : null,
                h("details", { className: "drm-connections" }, h("summary", null, "连接信息 · " + (error ? "状态不可用" : availableBridges + " 个活跃桥") + " / " + files.length + " 个已记录实例 · 空闲实例已收起"), files.length ? files.map((file, i) => h("div", { className: "drm-bridge-row", key: file.file || i }, h("span", { className: "drm-mono" }, file.bridge?.instanceId || file.file || "未知实例"), h("span", null, file.error || (error || file.bridge?.stale ? "状态过期" : file.bridge?.state === "running" ? "运行中" : file.bridge?.state === "stopped" ? "已停止" : "空闲") + " · " + (file.runs?.length || 0) + " 个任务"))) : h("p", { className: "drm-detail-note" }, "尚未发现 bridge 状态文件。")), h("p", { className: "drm-detail-note" }, "每张卡片对应一个 SDK 会话的当前 run；内部子代理不单独计数。"));
        }
        function apply(ctx) {
            const slots = ctx.get("slots");
            if (!slots)
                return;
            slots.inject("conversation.view", () => slots.register({ name: "conversation.view", id: "dsh-bridge", order: 20, label: "DSH 任务" }, BridgeView));
        }
        return { apply, inject: ["slots"] };
    }
});
