window.__ModuleLoader__.load({
    id: "dsh-run-monitor",
    factory: (require) => {
        const React = require("react");
        const h = React.createElement;
        let MarkdownText; try { MarkdownText=require("@deepseek-ai/dsh-client-ui-primitives").MarkdownText; } catch {}
        const API_PATH = "/api/dsh-run-monitor";
        const CSS = `
.drm-view{--drm-bg:var(--dsw-alias-bg-base,#fff);--drm-fg:var(--dsw-alias-label-primary,#20252f);--drm-muted:var(--dsw-alias-label-secondary,#7b808b);--drm-line:var(--dsw-alias-border-l3,rgba(128,128,128,.18));--drm-soft:rgba(128,128,128,.055);--drm-accent:#4d6bfe;display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0;overflow-y:auto;padding:24px 28px 32px;box-sizing:border-box;color:var(--drm-fg);font-size:13px;line-height:1.5;container-type:inline-size}
.drm-view *{box-sizing:border-box}.drm-view button,.drm-view input,.drm-view select{font:inherit;color:inherit}.drm-view button{cursor:pointer}.drm-view button:disabled{cursor:default;opacity:.55}.drm-view button:focus-visible,.drm-view input:focus-visible,.drm-view select:focus-visible,.drm-view summary:focus-visible{outline:2px solid var(--drm-accent);outline-offset:3px}.drm-view h2,.drm-view h3,.drm-view p{margin:0}.drm-muted{color:var(--drm-muted)}.drm-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.drm-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.drm-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.drm-heading{display:flex;align-items:center;gap:12px}.drm-logo{display:grid;place-items:center;width:38px;height:38px;border:1px solid rgba(77,107,254,.2);background:rgba(77,107,254,.07);border-radius:11px;color:var(--drm-accent)}.drm-view h2{font-size:20px;font-weight:650;letter-spacing:-.4px}.drm-subtitle{font-size:12px;color:var(--drm-muted);margin-top:2px!important}.drm-sync{display:flex;align-items:center;gap:10px;color:var(--drm-muted);font-size:11px}.drm-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}.drm-dot-live{color:#24946b;box-shadow:0 0 0 3px rgba(36,148,107,.09)}.drm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--drm-line);border-radius:7px;background:transparent;padding:6px 10px;font-size:12px!important;white-space:nowrap}.drm-btn:hover:not(:disabled){background:var(--drm-soft)}.drm-btn-primary{color:var(--drm-accent)!important;background:rgba(77,107,254,.06)}.drm-spin svg{animation:drm-spin 1s linear infinite}@keyframes drm-spin{to{transform:rotate(360deg)}}
.drm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:24px}.drm-stat{padding:16px 18px;border:1px solid var(--drm-line);border-radius:10px;background:var(--drm-soft);min-width:0}.drm-stat-label{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--drm-muted)}.drm-stat-value{display:block;margin-top:8px;font-size:28px;font-weight:600;line-height:1.2;letter-spacing:-.7px;font-variant-numeric:tabular-nums}.drm-stat-value small{font-size:12px;font-weight:400;letter-spacing:0;color:var(--drm-muted);margin-left:6px}.drm-stat-note{margin-top:5px;font-size:11px;color:var(--drm-muted)}.drm-blue{color:var(--drm-accent)}.drm-amber{color:#b98324}
.drm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}.drm-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--drm-line);border-radius:8px;background:var(--drm-soft)}.drm-tab{border:0;background:transparent;padding:5px 12px;border-radius:5px;font-size:12px!important;color:var(--drm-muted)!important;display:flex;align-items:center;gap:7px}.drm-tab[aria-pressed=true]{background:var(--drm-bg);color:var(--drm-fg)!important;box-shadow:0 1px 4px rgba(0,0,0,.07)}.drm-count{font:10px ui-monospace,Consolas,monospace;min-width:17px;padding:1px 4px;border-radius:4px;background:rgba(128,128,128,.1)}.drm-filters{display:flex;gap:8px;flex:1;justify-content:flex-end}.drm-search{display:flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid var(--drm-line);border-radius:7px;max-width:270px;min-width:110px;color:var(--drm-muted)}.drm-search input{min-width:0;width:100%;border:0;outline:0;background:transparent;font-size:12px!important}.drm-select{max-width:170px;border:1px solid var(--drm-line);border-radius:7px;background:var(--drm-bg);padding:5px 8px;font-size:12px!important}.drm-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:11px;color:var(--drm-muted)}
.drm-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}.drm-layout[data-detail=true]{grid-template-columns:minmax(0,1fr) 320px}.drm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr));gap:14px;align-items:start}.drm-card{display:flex;flex-direction:column;border:1px solid var(--drm-line);border-radius:11px;padding:17px;background:var(--drm-bg);text-align:left;width:100%;min-width:0;position:relative;transition:border-color .15s,box-shadow .15s}.drm-card:hover{border-color:rgba(77,107,254,.5);box-shadow:0 3px 12px rgba(0,0,0,.035)}.drm-card[aria-pressed=true]{border-color:var(--drm-accent);box-shadow:0 0 0 1px var(--drm-accent)}.drm-card[data-status=running]{border-top:2px solid var(--drm-accent);padding-top:16px}.drm-card[data-status=stale],.drm-card[data-status=error]{border-top:2px solid #b98324;padding-top:16px}.drm-card-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}.drm-agent-id{color:var(--drm-muted);font-size:10px}.drm-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 7px;border-radius:5px;background:var(--drm-soft);color:var(--drm-muted)}.drm-chip[data-status=running]{color:var(--drm-accent);background:rgba(77,107,254,.09)}.drm-chip[data-status=succeeded]{color:#24946b;background:rgba(36,148,107,.09)}.drm-chip[data-status=queued]{color:#9272cd;background:rgba(146,114,205,.09)}.drm-chip[data-status=error],.drm-chip[data-status=stale],.drm-chip[data-status=interrupted],.drm-chip[data-status=incomplete]{color:#b98324;background:rgba(185,131,36,.1)}.drm-task-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:22px;overflow-wrap:anywhere}.drm-card h3{font-size:15px;font-weight:600;letter-spacing:-.2px}.drm-model{margin-top:3px;font-size:11px;color:var(--drm-muted)}.drm-stage{display:flex;align-items:center;gap:7px;margin:16px 0 10px;font-size:11px;color:var(--drm-muted)}.drm-stage-line{height:2px;flex:1;background:var(--drm-line)}.drm-stage .drm-current{color:var(--drm-accent)}.drm-stage .drm-done{color:#24946b}.drm-activity{background:var(--drm-soft);border-radius:7px;padding:10px 11px;min-height:57px}.drm-activity-main{display:flex;justify-content:space-between;gap:8px;font-size:12px}.drm-activity-sub{margin-top:4px;font-size:10px;color:var(--drm-muted)}.drm-card-metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.drm-metric-label{display:block;font-size:10px;color:var(--drm-muted)}.drm-metric-value{display:block;margin-top:3px;font-size:15px;font-weight:550;font-variant-numeric:tabular-nums}.drm-metric-sub{display:block;margin-top:2px;font-size:10px;color:var(--drm-muted)}.drm-card-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:10px;border-top:1px solid var(--drm-line);color:var(--drm-muted);font-size:10px}.drm-card-link{display:inline-flex;align-items:center;gap:3px;color:var(--drm-accent)}
.drm-detail{position:sticky;top:0;max-height:70vh;overflow-y:auto;border:1px solid var(--drm-line);border-radius:11px;padding:18px;min-width:0;background:var(--drm-bg)}.drm-detail-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.drm-detail h3{font-size:14px;font-weight:600}.drm-detail-group{margin-top:18px;padding-top:15px;border-top:1px solid var(--drm-line)}.drm-detail-title{font-size:11px;font-weight:600;margin-bottom:10px;color:var(--drm-muted)}.drm-kv{display:flex;justify-content:space-between;gap:16px;font-size:11px;padding:4px 0}.drm-kv dt{color:var(--drm-muted);flex:none}.drm-kv dd{margin:0;text-align:right;overflow-wrap:anywhere;min-width:0}.drm-detail dl{margin:0}.drm-detail-id{display:block;overflow-wrap:anywhere;font-size:11px;padding:10px;background:var(--drm-soft);border-radius:6px;margin:10px 0;color:var(--drm-muted)}.drm-detail-note{font-size:11px;color:var(--drm-muted);margin-top:9px!important;overflow-wrap:anywhere}.drm-detail-group .drm-btn{width:100%;margin-top:8px}.drm-detail-head h3{white-space:nowrap}.drm-detail-head .drm-btn{flex:none}.drm-banner{border:1px solid rgba(185,131,36,.3);background:rgba(185,131,36,.06);border-radius:8px;padding:10px 13px;color:#b98324;font-size:12px;margin-bottom:16px;overflow-wrap:anywhere}.drm-empty{grid-column:1/-1;text-align:center;border:1px dashed var(--drm-line);border-radius:11px;padding:46px 20px;color:var(--drm-muted)}.drm-empty-icon{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--drm-soft);margin-bottom:12px}.drm-empty h3{font-size:14px;color:var(--drm-fg);margin-bottom:5px}.drm-empty p{font-size:12px}.drm-empty .drm-btn{margin-top:16px}.drm-connections{margin-top:20px;padding-top:12px;border-top:1px solid var(--drm-line);font-size:11px;color:var(--drm-muted)}.drm-connections summary{cursor:pointer}.drm-idle-connections{margin-top:10px;padding:10px;background:var(--drm-soft);border-radius:7px}.drm-bridge-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--drm-line);overflow-wrap:anywhere}.drm-bridge-row:last-child{border:0}
.drm-connection-page{min-width:0}.drm-connection-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}.drm-connection-summary .drm-stat{padding:12px 14px;border:0}.drm-connection-summary .drm-stat-value{font-size:22px}.drm-connection-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:10px;margin-top:10px}.drm-connection-card{padding:12px;border:1px solid var(--drm-line);border-radius:8px;min-width:0}.drm-connection-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:550}.drm-connection-card-meta{font-size:10px;color:var(--drm-muted);margin-top:5px}.drm-idle-toggle{margin-top:8px}
.drm-session-view{padding-top:20px}.drm-session-content{width:100%;max-width:1080px;margin:0 auto}.drm-session-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}.drm-readonly{font-size:11px;color:var(--drm-muted);border:1px solid var(--drm-line);border-radius:5px;padding:3px 8px}.drm-session-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}.drm-session-heading>.drm-chip{flex:none;white-space:nowrap}.drm-session-heading>div{min-width:0}.drm-session-heading h2{overflow-wrap:anywhere}.drm-session-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;padding:15px 18px;background:var(--drm-soft);border:1px solid var(--drm-line);border-radius:10px;margin-bottom:20px}.drm-session-metrics .drm-metric-value{font-size:19px}.drm-session-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--drm-line);padding-bottom:12px}.drm-transcript{max-width:920px;margin:0 auto;padding:22px 4px 20px;overflow-wrap:anywhere}.drm-message{padding:12px 0 24px}.drm-message[data-kind=user]{padding:16px 18px;background:var(--drm-soft);border:1px solid var(--drm-line);border-radius:12px;margin-bottom:22px}.drm-message-heading{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px}.drm-message-avatar{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:rgba(77,107,254,.08);color:var(--drm-accent);font-size:11px;font-weight:600}.drm-message-time{font-size:10px;font-weight:400;color:var(--drm-muted);margin-left:auto;white-space:nowrap}.drm-message-body{font-size:13px;line-height:1.85;white-space:normal}.drm-message-body p{white-space:pre-wrap;margin:8px 0}.drm-message-body h2,.drm-message-body h3,.drm-message-body h4,.drm-message-body h5{margin:18px 0 10px;font-size:15px}.drm-message-body code{font:12px ui-monospace,Consolas,monospace;background:var(--drm-soft);border-radius:4px;padding:2px 4px}.drm-message-body pre,.drm-tool-body pre{overflow:auto;max-height:420px;padding:14px;border:1px solid var(--drm-line);border-radius:8px;background:var(--drm-soft);font:11px/1.7 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.drm-message-body pre code{padding:0;background:none}.drm-tool-entry{border:1px solid var(--drm-line);border-radius:8px;margin:9px 0 12px;overflow:hidden}.drm-tool-entry summary{display:flex;align-items:center;gap:9px;padding:11px 13px;cursor:pointer;background:var(--drm-soft);list-style:none}.drm-tool-entry summary::before{content:'›';font-size:16px;color:var(--drm-muted)}.drm-tool-entry[open] summary::before{transform:rotate(90deg)}.drm-tool-entry summary::-webkit-details-marker{display:none}.drm-tool-icon{font-size:11px;color:var(--drm-muted)}.drm-tool-name{min-width:0;overflow-wrap:anywhere;font-size:12px;font-weight:550}.drm-tool-state{font-size:10px;color:var(--drm-muted)}.drm-tool-state[data-status=error]{color:#c65353}.drm-tool-state[data-status=completed]{color:#24946b}.drm-tool-body{padding:12px 14px 0}.drm-tool-body:last-child{padding-bottom:10px}.drm-tool-body pre{margin:6px 0 10px;max-height:300px}.drm-event-entry{display:flex;align-items:center;justify-content:center;gap:10px;margin:18px 0;font-size:10px;color:var(--drm-muted)}.drm-event-entry::before,.drm-event-entry::after{content:'';flex:1;height:1px;background:var(--drm-line)}.drm-load-older{display:flex;margin:0 auto 20px}.drm-jump-latest{display:flex;margin:18px auto 0}.drm-info-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:18px;padding-top:20px}.drm-info-group{border:1px solid var(--drm-line);border-radius:10px;padding:18px;min-width:0}.drm-info-group h3{font-size:13px;margin-bottom:12px}.drm-info-group dl{margin:0}.drm-info-group .drm-kv{padding:6px 0}.drm-session-footnote{text-align:center;font-size:11px;color:var(--drm-muted);padding:16px 0}
@container(max-width:640px){.drm-session-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:14px}.drm-session-toolbar{align-items:flex-start;flex-wrap:wrap}.drm-session-heading>.drm-chip{flex:none;white-space:nowrap}.drm-session-heading>div{min-width:0}.drm-session-heading h2{font-size:18px}.drm-transcript{padding-left:0;padding-right:0}.drm-tool-entry summary{gap:6px}.drm-session-nav{margin-bottom:16px}}
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
        function taskName(run) { return typeof run.title==="string" && run.title.trim() ? run.title.trim() : "任务 " + shortId(run.sessionId); }
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
                    const archived = file.archived === true;
                    const claimedLive = run.isRunning === true || run.status === "running" || run.status === "queued";
                    const stale = unavailable || bridge.stale === true;
                    let status = run.status || "unknown";
                    if (claimedLive)
                        status = stale ? "stale" : bridge.state === "stopped" ? "stopped" : bridge.state !== "running" ? "incomplete" : run.status === "queued" ? "queued" : "running";
                    if (archived && (claimedLive || status === "stale")) status = "stopped";
                    const live = !archived && (status === "running" || status === "queued");
                    const attention = !archived && ["stale", "error", "interrupted", "incomplete", "unknown"].includes(status);
                    entries.push({ key: JSON.stringify([archived, file.file || bridge.instanceId || fi, run.sessionId || ri]), run, bridge, status, live, stale, attention, archived });
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
            return h("button", { type: "button", className: "drm-card", "data-status": status, "aria-pressed": selected, "aria-label": "查看任务 " + taskName(run) + " " + shortId(run.sessionId), onClick: () => onSelect(entry.key), key: entry.key }, h("span", { className: "drm-card-top" }, chip(status), h("span", { className: "drm-agent-id drm-mono" }, "AGENT / " + shortId(run.sessionId))), h("h3", { className: "drm-task-title", title: taskName(run) }, taskName(run)), h("span",{className:"drm-model drm-truncate",title:run.cwd},workspace(run.cwd)), h("span", { className: "drm-model drm-truncate", title: (run.provider || "") + " / " + (run.model || "") }, (run.provider || "未知提供商") + " / " + (run.model || "未知模型")), h("span", { className: "drm-stage", "aria-label": "执行阶段" }, h("span", { className: "drm-done" }, "已连接"), h("span", { className: "drm-stage-line" }), h("span", { className: live ? "drm-current" : "" }, status === "queued" ? "排队中" : live ? "执行中" : status === "stale" ? "连接中断" : "已执行"), h("span", { className: "drm-stage-line" }), h("span", { className: status === "succeeded" ? "drm-done" : "" }, status === "succeeded" ? "已完成" : live ? "待结束" : labels[status] || "已结束")), h("span", { className: "drm-activity" }, h("span", { className: "drm-activity-main" }, h("span", { className: "drm-truncate", title: phase(entry) }, phase(entry)), h("span", { className: "drm-mono" }, duration(run.durationMs))), h("span", { className: "drm-activity-sub" }, (live ? stepLabel(run) : progress && isCount(progress.completedSteps) ? "已完成 " + progress.completedSteps + " 个步骤" : "本轮执行已结束") + (live && progress && isCount(progress.completedSteps) ? " · 已完成 " + progress.completedSteps + " 步" : ""))), h("span", { className: "drm-card-metrics" }, metric("累计 token", tokens(run.usage?.totalTokens, true), usageNote(run.usage), tokens(run.usage?.totalTokens)), metric("上下文窗口", isCount(run.contextWindow) && run.contextWindow > 0 ? tokens(run.contextWindow, true) : "未上报", "占用量未上报")), h("span", { className: "drm-card-footer" }, h("span", null, entry.archived ? "已归档 · " + (run.finishedAt ? clock(run.finishedAt) : "历史快照") : stale ? "缓存快照 · 非实时" : live ? "活动于 " + age(run.lastEventAgeMs) : "结束于 " + clock(run.finishedAt)), h("span", { className: "drm-card-link" }, "查看详情", icon("arrow", 12))));
        }
        function kv(label, value) { return h("div", { className: "drm-kv", key: label }, h("dt", null, label), h("dd", null, value)); }
        function inlineText(text) {
            return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) =>
                part.startsWith("**") && part.endsWith("**") ? h("strong", {key:i}, part.slice(2,-2)) :
                part.startsWith("`") && part.endsWith("`") ? h("code", {key:i}, part.slice(1,-1)) : part);
        }
        function markdown(text) {
            if (MarkdownText) return h(MarkdownText, {text:String(text)});
            return String(text).split(/```([^\n`]*)\n([\s\S]*?)```/g).map((part, index, all) => {
                if (index % 3 === 1) return null;
                if (index % 3 === 2) return h("pre", {key:index}, h("code", {"data-language":all[index-1]}, part));
                return part.split(/\n\s*\n/).filter(Boolean).map((paragraph, pi) => {
                    const heading = paragraph.match(/^(#{1,4})\s+([^\n]+)$/);
                    return heading ? h("h" + Math.min(heading[1].length+1,5), {key:index+":"+pi}, inlineText(heading[2])) :
                        h("p", {key:index+":"+pi}, inlineText(paragraph));
                });
            });
        }
        function transcriptItem(item) {
            if (item.kind === "tool") return h("details", {className:"drm-tool-entry", key:item.id},
                h("summary", null, h("span", {className:"drm-tool-icon drm-mono"}, ">_"),
                    h("span", {className:"drm-tool-name"}, item.toolName || "工具调用"),
                    h("span", {className:"drm-tool-state", "data-status":item.status}, item.status === "error" ? "失败" : ["completed","succeeded","ok"].includes(item.status) ? "已完成" : item.status === "running" || item.status === "called" || item.status === "pending" ? "执行中" : "执行记录"),
                    h("time", {className:"drm-message-time"}, clock(item.time))),
                item.arguments ? h("div", {className:"drm-tool-body"}, h("div", {className:"drm-metric-label"}, "参数"), h("pre", null, h("code", null, item.arguments))) : null,
                item.result ? h("div", {className:"drm-tool-body"}, h("div", {className:"drm-metric-label"}, "结果"), h("pre", null, h("code", null, item.result))) : null,
                item.truncated ? h("p", {className:"drm-detail-note"}, "较长内容已截断") : null);
            if (item.kind === "event") return h("div", {className:"drm-event-entry", key:item.id}, h("span", null, item.text || "运行事件"), h("time", null, clock(item.time)));
            return h("article", {className:"drm-message", "data-kind":item.kind, key:item.id},
                h("div", {className:"drm-message-heading"}, h("span", {className:"drm-message-avatar"}, item.kind === "user" ? "你" : "D"),
                    h("strong", null, item.kind === "user" ? "任务指令" : "DSH"), h("time", {className:"drm-message-time"}, clock(item.time))),
                h("div", {className:"drm-message-body"}, markdown(item.text || "")),
                item.truncated ? h("p", {className:"drm-detail-note"}, "较长内容已截断") : null);
        }
        function infoGroup(title, rows, note) {
            return h("section", {className:"drm-info-group", key:title}, h("h3", null, title), h("dl", null, rows.map(([key,value])=>kv(key,value))), note ? h("p", {className:"drm-detail-note"}, note) : null);
        }
        function detailPage(entry, state, actions) {
            const {run,bridge}=entry, usage=run.usage;
            const groups=[
                infoGroup("执行", [["状态",labels[entry.status]||"未知"],["模型",run.model||"未上报"],["提供商",run.provider||"未上报"],["当前阶段",phase(entry)],["当前步骤",entry.live?stepLabel(run):"已结束"],["已完成步骤",tokens(run.progress?.completedSteps)],["近期工具成功 / 调用",isCount(run.progress?.completedToolCalls)&&isCount(run.progress?.toolCalls)?run.progress.completedToolCalls+" / "+run.progress.toolCalls:"未上报"]]),
                infoGroup("Token 用量", [["累计已上报",tokens(usage?.totalTokens)],["未缓存输入",tokens(usage?.uncachedInputTokens)],["缓存读取",tokens(usage?.cacheReadTokens)],["缓存写入",tokens(usage?.cacheWriteTokens)],["输出",tokens(usage?.outputTokens)]],usageNote(usage)+"；仅统计当前 run，不包含续聊前历史与内部子代理。"),
                infoGroup("上下文与时间", [["上下文窗口",tokens(run.contextWindow)],["当前占用","未上报"],["开始时间",clock(run.startedAt,true)],["结束时间",clock(run.finishedAt,true)],["工作目录",run.cwd||"—"],["会话 ID",run.sessionId||"—"],["桥实例",bridge.instanceId||"—"]],run.note)
            ];
            return h("div", {className:"drm-view drm-session-view", key:"session", ref:actions.pageRef, onKeyDown:e=>{if(e.key==="Escape")actions.back();}, "aria-label":"任务会话详情"},
                h("div", {className:"drm-session-content"},
                    h("div", {className:"drm-session-nav"}, h("button", {type:"button",className:"drm-btn",onClick:actions.back,"aria-label":"返回任务概览"}, "‹ 返回任务概览"), h("span", {className:"drm-readonly"}, "只读会话")),
                    h("header", {className:"drm-session-heading"}, h("div", null, h("h2", null, taskName(run)), h("p", {className:"drm-subtitle"}, workspace(run.cwd)+" · "+shortId(run.sessionId)+" · "+(run.provider||"?")+" / "+(run.model||"?"))), chip(entry.status)),
                    h("section", {className:"drm-session-metrics", "aria-label":"任务关键指标"}, metric("执行用时",duration(run.durationMs),entry.live?phase(entry):"本轮执行已结束"), metric("已完成步骤",tokens(run.progress?.completedSteps),entry.live?stepLabel(run):""), metric("累计 token",tokens(usage?.totalTokens,true),usageNote(usage)), metric("上下文窗口",tokens(run.contextWindow,true),"占用量未上报")),
                    h("div", {className:"drm-session-toolbar"}, h("div", {className:"drm-tabs",role:"group","aria-label":"详情视图"}, [["conversation","会话记录"],["info","运行信息"]].map(([id,label])=>h("button",{type:"button",className:"drm-tab",key:id,"aria-pressed":state.tab===id,onClick:()=>actions.setTab(id)},label))),
                        state.tab==="conversation"?h("div",{className:"drm-sync"},h("span",null,state.loading?"读取中…":entry.live?"实时更新":"执行记录"),h("button",{type:"button",className:"drm-btn",onClick:actions.refresh,disabled:state.loading,"aria-label":"刷新会话记录"},icon("refresh",13),"刷新")):null),
                    state.tab==="info"?h("div",{className:"drm-info-grid"},groups):h("section", {className:"drm-transcript", "aria-label":"只读会话记录"},
                        state.error?h("div",{className:"drm-banner",role:"alert"},state.error,h("button",{type:"button",className:"drm-btn",onClick:actions.refresh},"重试")):null,
                        state.timeline.hasOlder?h("button",{type:"button",className:"drm-btn drm-load-older",disabled:state.olderLoading,onClick:actions.older},state.olderLoading?"加载中…":"加载更早的记录"):null,
                        !state.timeline.loaded&&state.loading?empty("正在读取会话","加载任务指令、助手回复和工具执行记录…"):state.timeline.loaded&&!state.timeline.entries.length&&!state.error?empty("暂无会话记录",entry.live?"任务开始产生消息后会自动更新。":"当前会话没有可展示的记录。"):state.timeline.entries.map(transcriptItem),
                        h("div",{ref:actions.endRef}),
                        state.timeline.entries.length?h("button",{type:"button",className:"drm-btn drm-jump-latest",onClick:()=>actions.endRef.current?.scrollIntoView({block:"end",behavior:"smooth"})},"↓ 跳至最新记录"):null),
                    h("p",{className:"drm-session-footnote"},"仅查看此 SDK 任务的执行过程，无法在此发送消息或运行工具。")));
        }
        function mergeTranscript(previous, value, identity, older) {
            const same=previous.identity===identity&&previous.loaded;
            const merged=new Map((same?previous.entries:[]).map(item=>[item.id,item]));
            for(const item of (Array.isArray(value.entries)?value.entries:[])) merged.set(item.id,item);
            return {identity,loaded:true,entries:[...merged.values()].sort((a,b)=>a.seq-b.seq),hasOlder:older||!same?value.hasOlder===true:previous.hasOlder,beforeSeq:older||!same?value.beforeSeq:previous.beforeSeq,lastSeq:value.lastSeq};
        }
        function empty(title, message, action) { return h("div", { className: "drm-empty", role: "status" }, h("span", { className: "drm-empty-icon" }, icon("activity", 22)), h("h3", null, title), h("p", null, message), action); }
        function stat(label, value, note, tone, unit) { return h("div", { className: "drm-stat" }, h("div", { className: "drm-stat-label" }, h("span", { className: "drm-dot " + (tone || "") }), label), h("span", { className: "drm-stat-value " + (tone || "") }, value, unit ? h("small", null, unit) : null), h("div", { className: "drm-stat-note" }, note)); }
        function callApi(signal, body = {method:"state"}) {
            return fetch(API_PATH, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body), signal }).then(async (response) => {
                const result = await response.json().catch(() => null);
                if (!response.ok || result === null)
                    throw new Error(result?.error?.message || "HTTP " + response.status);
                return result;
            });
        }
        function connectionCards(files, unavailable) {
            return files.map((file, i) => {
                const bridge = file.bridge || {};
                const runs = Array.isArray(file.runs) ? file.runs : [];
                const status = file.error ? "error" : unavailable || bridge.stale ? "stale" : bridge.state === "running" ? "running" : "stopped";
                return h("div", { className: "drm-connection-card", key: file.file || i },
                    h("div", { className: "drm-connection-card-head" },
                        h("span", { className: "drm-truncate", title: runs[0]?.cwd }, runs[0]?.cwd ? workspace(runs[0].cwd) : "尚未执行任务"),
                        bridge.state === "idle" && !unavailable && !file.error ? h("span", { className: "drm-chip" }, "空闲") : chip(status)),
                    h("div", { className: "drm-connection-card-meta drm-truncate", title: bridge.instanceId || file.file }, bridge.instanceId || file.file || "未知实例"),
                    h("div", { className: "drm-connection-card-meta" }, file.error || runs.length + " 个任务快照"));
            });
        }
        function connections(files, data, unavailable, showIdle, onToggleIdle, onClose) {
            const idle = files.filter(f => f?.bridge?.state === "idle" && !f.error && (!Array.isArray(f.runs) || f.runs.length === 0));
            const idleSet = new Set(idle);
            const idleTotal = files.filter(f => f?.bridge?.state === "idle" && !f.error).length;
            const relevant = files.filter(f => f && !idleSet.has(f));
            const running = unavailable ? 0 : files.filter(f => f?.bridge?.state === "running" && !f.bridge.stale).length;
            const archive = data?.archiveSummary;
            const archivedCount = isCount(archive?.files) ? archive.files : 0;
            const discovered = isCount(data?.discoveredFiles) ? data.discoveredFiles : files.length;
            return h("section", { className: "drm-connection-page", "aria-label": "桥连接信息" },
                h("header", { className: "drm-header" }, h("div", null, h("h2", null, "连接管理"), h("p", { className: "drm-subtitle" }, unavailable ? "连接不可用，当前为上次快照" : "查看进程连接与归档记录")),
                    h("button", { type: "button", className: "drm-btn", "aria-label": "返回任务概览", onClick: onClose }, "返回任务概览")),
                h("div", { className: "drm-connection-summary" },
                    stat("正在执行", running, "桥进程", "drm-blue"), stat("空闲连接", idleTotal, idle.length + " 个尚无任务"), stat("已归档", archivedCount, "已退出的实例")),
                relevant.length ? h("div", { className: "drm-connection-grid" }, connectionCards(relevant, unavailable)) : null,
                idle.length ? h("button", { type: "button", className: "drm-btn drm-idle-toggle", "aria-label": "查看空闲连接", "aria-expanded": showIdle, onClick: onToggleIdle }, showIdle ? "收起空闲连接" : "查看 " + idle.length + " 个空闲连接") : null,
                showIdle ? h("div", { className: "drm-connection-grid", "aria-label": "空闲桥" }, connectionCards(idle, unavailable)) : null,
                archivedCount ? h("p", { className: "drm-detail-note" }, "已退出的桥已归档；其中的任务可在「已结束」查看。") : null,
                data?.truncated ? h("p", { className: "drm-detail-note" }, "归档较多或部分文件无法读取，当前仅载入部分记录。") : null,
                discovered > files.length ? h("p", { className: "drm-detail-note" }, "当前载入 " + files.length + " / " + discovered + " 个实例记录。") : null);
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
            const [detailOpen, setDetailOpen] = React.useState(false);
            const [detailTarget, setDetailTarget] = React.useState(null);
            const [detailTab, setDetailTab] = React.useState("conversation");
            const [timeline, setTimeline] = React.useState({identity:null,loaded:false,entries:[],hasOlder:false,beforeSeq:null});
            const [transcriptLoading, setTranscriptLoading] = React.useState(false);
            const [olderLoading, setOlderLoading] = React.useState(false);
            const [transcriptError, setTranscriptError] = React.useState(null);
            const timelineRef=React.useRef(timeline), transcriptLoad=React.useRef(null), requestVersion=React.useRef(0);
            const overviewRef=React.useRef(null), overviewScroll=React.useRef(0), sessionPageRef=React.useRef(null), transcriptEndRef=React.useRef(null), scrollAnchor=React.useRef(null), detailSnapshot=React.useRef(null);
            timelineRef.current=timeline;
            const [limit, setLimit] = React.useState(30);
            const [showConnections, setShowConnections] = React.useState(false);
            const [showIdleConnections, setShowIdleConnections] = React.useState(false);
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
            const archivedFiles = data && Array.isArray(data.archivedFiles) ? data.archivedFiles : [];
            const entries = flatten(files.concat(archivedFiles), error !== null);
            const live = entries.filter(e => e.live), attention = entries.filter(e => e.attention), history = entries.filter(e => e.archived || ["succeeded", "error", "interrupted", "stopped", "incomplete"].includes(e.status));
            const scoped = scope === "history" ? history : scope === "attention" ? attention : live;
            const normalized = query.trim().toLowerCase();
            const visible = scoped.filter(e => (!model || e.run.model === model) && (!normalized || [e.run.title, e.run.cwd, e.run.sessionId, e.run.provider, e.run.model, e.bridge.instanceId, labels[e.status]].join(" ").toLowerCase().includes(normalized)));
            const models = [...new Set(entries.map(e => e.run.model).filter(Boolean))].sort();
            const selectedEntry = entries.find(e => e.key === selected);
            const matchingDetail = detailTarget ? entries.find(e=>e.run.sessionId===detailTarget.sessionId && e.bridge.instanceId===detailTarget.bridgeInstanceId) : null;
            if(matchingDetail) detailSnapshot.current=matchingDetail;
            const detailEntry=matchingDetail || (detailSnapshot.current ? {...detailSnapshot.current,live:false,stale:true,status:"stale"} : null);
            const detailIdentity=detailTarget ? JSON.stringify([detailTarget.bridgeInstanceId,detailTarget.sessionId]) : "";
            const detailLive=detailEntry?.live===true;
            React.useEffect(()=>{
                if(detailOpen && typeof props.blockComposer==="function") return props.blockComposer();
            },[detailOpen,props.blockComposer]);
            React.useEffect(()=>{
                if(!detailOpen && !showConnections && overviewRef.current) overviewRef.current.scrollTop=overviewScroll.current;
            },[detailOpen,showConnections]);
            (React.useLayoutEffect||React.useEffect)(()=>{
                const anchor=scrollAnchor.current, node=sessionPageRef.current;
                if(anchor&&node){node.scrollTop=anchor.top+Math.max(0,node.scrollHeight-anchor.height);scrollAnchor.current=null;}
            },[timeline.entries]);
            React.useEffect(()=>{
                if(!detailOpen || !detailTarget || detailTab!=="conversation") return;
                let disposed=false,inFlight=false,controller,timerId,timeoutId;
                const version=++requestVersion.current;
                if(timelineRef.current.identity!==detailIdentity){
                    const blank={identity:detailIdentity,loaded:false,entries:[],hasOlder:false,beforeSeq:null};
                    timelineRef.current=blank;setTimeline(blank);setTranscriptError(null);
                }
                const loadTranscript=async(older=false)=>{
                    if(disposed||inFlight)return;
                    inFlight=true;clearTimeout(timerId);
                    controller=new AbortController();timeoutId=setTimeout(()=>controller.abort(),10000);
                    if(older)setOlderLoading(true);else setTranscriptLoading(true);
                    const body={method:"transcript",sessionId:detailTarget.sessionId,bridgeInstanceId:detailTarget.bridgeInstanceId,limit:80};
                    if(older)body.beforeSeq=timelineRef.current.beforeSeq;
                    try{
                        const result=await callApi(controller.signal,body);
                        if(disposed||requestVersion.current!==version)return;
                        if(!result?.ok||!result.value)throw new Error(result?.error?.message||"会话记录读取失败");
                        if(older&&sessionPageRef.current)scrollAnchor.current={top:sessionPageRef.current.scrollTop,height:sessionPageRef.current.scrollHeight};
                        setTimeline(previous=>{const next=mergeTranscript(previous,result.value,detailIdentity,older);timelineRef.current=next;return next;});
                        setTranscriptError(null);
                    }catch(error){
                        if(!disposed&&requestVersion.current===version)setTranscriptError(controller.signal.aborted?"会话读取超时，请重试":String(error?.message||error));
                    }finally{
                        clearTimeout(timeoutId);inFlight=false;
                        if(!disposed){setTranscriptLoading(false);setOlderLoading(false);if(detailLive)timerId=setTimeout(()=>loadTranscript(false),document.hidden?30000:3000);}
                    }
                };
                transcriptLoad.current=loadTranscript;loadTranscript(false);
                return()=>{disposed=true;controller?.abort();clearTimeout(timerId);clearTimeout(timeoutId);if(transcriptLoad.current===loadTranscript)transcriptLoad.current=null;};
            },[detailOpen,detailIdentity,detailTab,detailLive]);
            const reported = visible.filter(e => isCount(e.run.usage?.totalTokens));
            const total = reported.reduce((sum, e) => sum + e.run.usage.totalTokens, 0);
            const totalKnown = reported.length > 0 && Number.isSafeInteger(total);
            const totalPartial = reported.length < visible.length || reported.some(e => e.run.usage.partial === true || e.run.usage.complete === false);
            const errors = files.filter(f => f?.error);
            const changeScope = value => { setScope(value); setSelected(null); setLimit(30); };
            const reset = () => { setQuery(""); setModel(""); setSelected(null); setLimit(30); };
            const refresh = () => { clearTimeout(timer.current); load.current(); };
            const openTask=key=>{const entry=entries.find(e=>e.key===key);if(!entry)return;overviewScroll.current=overviewRef.current?.scrollTop||0;detailSnapshot.current=entry;setSelected(key);setDetailTarget({sessionId:entry.run.sessionId,bridgeInstanceId:entry.bridge.instanceId});setDetailTab("conversation");setDetailOpen(true);};
            if(detailOpen && detailEntry) return detailPage(detailEntry,{tab:detailTab,timeline,loading:transcriptLoading,olderLoading,error:transcriptError},{back:()=>setDetailOpen(false),setTab:setDetailTab,refresh:()=>transcriptLoad.current?.(false),older:()=>transcriptLoad.current?.(true),pageRef:sessionPageRef,endRef:transcriptEndRef});
            if (showConnections) return h("div", { className: "drm-view", key: "connections" },
                connections(files, data, error !== null, showIdleConnections, () => setShowIdleConnections(!showIdleConnections), () => { setShowConnections(false); setShowIdleConnections(false); }));
            return h("div", { className: "drm-view", key: "tasks", ref: overviewRef }, h("header", { className: "drm-header" }, h("div", { className: "drm-heading" }, h("span", { className: "drm-logo" }, icon("grid", 20)), h("div", null, h("h2", null, "Agent 概览"), h("p", { className: "drm-subtitle" }, "DSH 任务 · 关注正在发生的事"))), h("div", { className: "drm-sync" }, h("span", { className: "drm-dot " + (error ? "drm-amber" : lastOkAt ? "drm-dot-live" : "") }), h("span", { className: "drm-sync-label" }, error ? "连接不可用" : lastOkAt ? "自动更新 · " + clock(lastOkAt) : "正在连接"), h("button", { type: "button", className: "drm-btn", "aria-label": "打开连接管理", onClick: () => setShowConnections(true) }, icon("activity", 13), "连接管理"), h("button", { type: "button", className: "drm-btn " + (refreshing ? "drm-spin" : ""), onClick: refresh, disabled: refreshing, "aria-label": "刷新任务状态" }, icon("refresh", 13), "刷新"))), error ? h("div", { className: "drm-banner", role: "alert" }, "读取失败：" + error + "。当前为上次快照，不计入实时运行数量。") : null, errors.length ? h("div", { className: "drm-banner", role: "alert" }, errors.length + " 个桥状态文件读取失败，可到连接管理页查看。") : null, h("section", { className: "drm-stats", "aria-label": "任务统计" }, stat("运行中", loading && !data ? "—" : live.filter(e => e.status === "running").length, "当前追踪的 SDK agent", "drm-blue"), stat("排队中", loading && !data ? "—" : live.filter(e => e.status === "queued").length, "已提交，等待执行"), stat("异常任务", loading && !data ? "—" : attention.length, "失败、中断或连接过期", attention.length ? "drm-amber" : ""), stat("当前列表用量", totalKnown ? tokens(total, true) : "—", totalKnown ? totalPartial ? "已上报累计 · 数据不完整" : "当前 run 已上报累计" : "暂无已上报用量", "", totalKnown ? "tok" : "")), h("div", { className: "drm-toolbar" }, h("div", { className: "drm-tabs", role: "group", "aria-label": "任务视图" }, [["live", "进行中", live.length], ["attention", "异常任务", attention.length], ["history", "已结束", history.length]].map(([value, label, count]) => h("button", { type: "button", className: "drm-tab", "aria-pressed": scope === value, key: value, onClick: () => changeScope(value) }, label, h("span", { className: "drm-count" }, count)))), h("div", { className: "drm-filters" }, h("label", { className: "drm-search" }, icon("search", 14), h("input", { type: "search", value: query, onChange: e => { setQuery(e.target.value); setSelected(null); setLimit(30); }, placeholder: "搜索工作区、会话…", "aria-label": "搜索任务" })), h("select", { className: "drm-select", value: model, "aria-label": "筛选模型", onChange: e => { setModel(e.target.value); setSelected(null); setLimit(30); } }, h("option", { value: "" }, "全部模型"), models.map(m => h("option", { value: m, key: m }, m))))), h("div", { className: "drm-section-head" }, h("span", null, (scope === "live" ? "进行中" : scope === "attention" ? "异常任务" : "已结束的任务") + " / " + visible.length), h("span", null, "按最近执行时间排序 · 点击卡片查看详情")), h("div", { className: "drm-layout", "data-detail": false }, h("div", { className: "drm-grid", "aria-label": "任务卡片" }, loading && !data ? empty("正在读取任务", "连接 DSH bridge…") : visible.length ? visible.slice(0, limit).map(e => card(e, selected === e.key, openTask)) : normalized || model ? empty("没有匹配的任务", "试试其他关键词或模型。", h("button", { className: "drm-btn", type: "button", onClick: reset }, "清除筛选")) : empty(scope === "live" ? "当前没有进行中的任务" : scope === "attention" ? "暂无异常任务" : "暂无已结束的任务", scope === "live" ? "新的 SDK 任务开始后会自动出现在这里。" : "任务状态会自动更新。", scope === "live" && history.length ? h("button", { className: "drm-btn", type: "button", onClick: () => changeScope("history") }, "查看 " + history.length + " 个已结束任务") : null)), null), visible.length > limit ? h("button", { type: "button", className: "drm-btn", style: { alignSelf: "center", marginTop: 16 }, onClick: () => setLimit(limit + 30) }, "加载更多 · 还有 " + (visible.length - limit) + " 个任务") : null,
                h("p", { className: "drm-detail-note" }, "每张卡片对应一个 SDK 会话的当前 run；内部子代理不单独计数。"));
        }
        function apply(ctx) {
            const slots = ctx.get("slots");
            if (!slots)
                return;
            slots.inject("conversation.view", () => slots.register({ name: "conversation.view", id: "dsh-bridge", order: 20, label: "DSH 任务", inject: sessionId => ({blockComposer:()=>{const blocks=ctx.get("conversation")?.blocks;if(!blocks)return;const store=blocks.storeFor(sessionId);if(store.getSnapshot())return;const own={reason:"只读任务会话，返回任务概览后可继续聊天"};blocks.set(sessionId,own);return()=>{if(store.getSnapshot()===own)blocks.set(sessionId,undefined);};}}) }, BridgeView));
        }
        return { apply, inject: ["slots", "conversation"] };
    }
});
