window.__ModuleLoader__.load({
	id: "dsh-run-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const ReactDOM = require("react-dom");

		const API_PATH = "/api/dsh-run-monitor";
		const POLL_RUNNING_MS = 3000;
		const POLL_IDLE_MS = 15000;
		const POLL_HIDDEN_MS = 30000;
		const FETCH_TIMEOUT_MS = 6000;

		const CSS = [
			".drm-toggle{display:inline-flex;align-items:center;gap:4px;width:auto;max-width:100%;min-width:0;flex:none;white-space:nowrap;padding:4px 6px;border:1px solid rgba(128,128,128,0.35);border-radius:8px;background:var(--dsw-specific-sidebar-fill,#fff);color:var(--dsw-alias-label-primary,inherit);cursor:pointer;font-size:12px;line-height:1;box-sizing:border-box;user-select:none}",
			".drm-dot{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-width:0;height:18px;padding:0 6px;border-radius:6px;background:#4d6bfe;color:#fff;font-size:10px;font-weight:700;letter-spacing:0.02em;white-space:nowrap;box-sizing:border-box;flex:none}",
			".drm-count{display:inline-flex;align-items:center;justify-content:center;min-width:13px;height:13px;padding:0 3px;border-radius:7px;background:rgba(255,255,255,0.28);color:#fff;font-size:9px;font-weight:700;line-height:13px;box-sizing:border-box;flex:none}",
			".drm-dot-idle{background:rgba(128,128,128,0.55)}",
			".drm-popup{position:fixed;right:16px;bottom:64px;width:390px;max-height:min(560px,calc(100vh - 96px));display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid rgba(128,128,128,0.28);border-radius:10px;background:var(--dsw-specific-sidebar-fill,#fff);color:var(--dsw-alias-label-primary,inherit);box-shadow:0 12px 32px rgba(0,0,0,0.28);font-size:12px;line-height:1.5;box-sizing:border-box;overflow-y:auto;z-index:10000}",
			".drm-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700;padding-bottom:4px;border-bottom:1px solid rgba(128,128,128,0.2)}",
			".drm-title small{font-weight:400;opacity:0.65}",
			".drm-refresh{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border:none;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:12px;flex:none}",
			".drm-refresh:hover:not(:disabled){background:rgba(128,128,128,0.2)}",
			".drm-refresh:disabled{opacity:0.55;cursor:not-allowed}",
			".drm-refresh.drm-spin{animation:drm-spin 0.8s linear infinite}",
			"@keyframes drm-spin{to{transform:rotate(360deg)}}",
			".drm-error{color:#e5484d;font-weight:600;word-break:break-word}",
			".drm-muted{opacity:0.65}",
			".drm-bridge{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;padding-top:4px;border-top:1px dashed rgba(128,128,128,0.25);font-weight:600}",
			".drm-bridge-state{font-weight:400;font-size:11px;opacity:0.8}",
			".drm-bridge-state.drm-stale{color:#e5a13d;opacity:1}",
			".drm-run{border:1px solid rgba(128,128,128,0.22);border-radius:8px;padding:7px;margin-top:5px;display:flex;flex-direction:column;gap:2px;background:rgba(128,128,128,0.04)}",
			".drm-run[data-status=running]{border-color:rgba(77,107,254,0.55)}",
			".drm-run[data-status=stale]{border-color:rgba(229,161,61,0.7)}",
			".drm-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
			".drm-chip{display:inline-flex;align-items:center;padding:1px 6px;border-radius:5px;background:rgba(128,128,128,0.18);font-size:11px;font-weight:700}",
			".drm-chip[data-status=running]{background:#4d6bfe;color:#fff}",
			".drm-chip[data-status=succeeded]{background:#18864b;color:#fff}",
			".drm-chip[data-status=error]{background:#c62f34;color:#fff}",
			".drm-chip[data-status=stale]{background:#b97a13;color:#fff}",
			".drm-chip[data-status=interrupted],.drm-chip[data-status=stopped],.drm-chip[data-status=incomplete]{background:rgba(128,128,128,0.55);color:#fff}",
			".drm-line{word-break:break-word}",
			".drm-kv{word-break:break-word;opacity:0.9}",
			".drm-k{opacity:0.62}",
			".drm-warn{color:#b97a13;font-weight:600}"
		].join("\n");

		const tagId = "dsh-run-monitor/dsh-run-monitor.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-run-monitor";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function statusLabel(status) {
			if (status === "running") return "运行中";
			if (status === "queued") return "排队中";
			if (status === "succeeded") return "已完成";
			if (status === "error") return "失败";
			if (status === "interrupted") return "已中断";
			if (status === "stopped") return "已停止";
			if (status === "incomplete") return "已结束";
			if (status === "stale") return "状态已过期";
			return "未知";
		}

		function bridgeLabel(bridge, stale) {
			if (stale === true) return "状态已过期";
			if (bridge === undefined || bridge === null) return "未知";
			if (bridge.stale === true) return "状态已过期";
			if (bridge.state === "running") return "运行中";
			if (bridge.state === "idle") return "空闲";
			if (bridge.state === "stopped") return "已停止";
			return "未知";
		}

		function fmtTokens(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
			return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}

		function fmtDuration(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "未知";
			if (ms < 1000) return Math.round(ms) + "ms";
			const seconds = ms / 1000;
			if (seconds < 60) return seconds.toFixed(seconds < 10 ? 1 : 0) + "s";
			const minutes = Math.floor(seconds / 60);
			const rest = Math.floor(seconds % 60);
			if (minutes < 60) return minutes + "m " + String(rest).padStart(2, "0") + "s";
			return Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m";
		}

		function fmtAge(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "未知";
			if (ms < 1000) return "刚刚";
			if (ms < 60000) return Math.floor(ms / 1000) + "s 前";
			if (ms < 3600000) return Math.floor(ms / 60000) + "m 前";
			return Math.floor(ms / 3600000) + "h 前";
		}

		function fmtClock(iso) {
			if (typeof iso !== "string" || iso === "") return "—";
			const at = new Date(iso);
			if (Number.isNaN(at.getTime())) return "—";
			try {
				return at.toLocaleTimeString("zh-CN", { hour12: false });
			} catch (e) {
				return at.toISOString();
			}
		}

		function shortId(value) {
			const raw = typeof value === "string" ? value : "";
			return raw.length > 24 ? raw.slice(0, 12) + "…" + raw.slice(-6) : (raw || "未知");
		}

		function workspaceName(cwd) {
			if (typeof cwd !== "string" || cwd === "") return "未知";
			const parts = cwd.split(/[\\/]+/).filter(Boolean);
			return parts.length === 0 ? cwd : parts[parts.length - 1];
		}

		function callApi(signal) {
			return fetch(API_PATH, {
				method: "POST",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ method: "state" }),
				signal
			}).then(async (response) => {
				const result = await response.json().catch(() => null);
				if (result === null) throw new Error("HTTP " + response.status);
				return result;
			});
		}

		function row(label, value, className) {
			return React.createElement("div", { className: className === undefined ? "drm-kv" : "drm-kv " + className },
				React.createElement("span", { className: "drm-k" }, label),
				React.createElement("span", null, value));
		}

		function usageOf(run) {
			return run && run.usage !== undefined && run.usage !== null ? run.usage : null;
		}

		function runCard(run, stale, index) {
			const usage = usageOf(run);
			const running = run.isRunning === true && !stale;
			const status = stale && run.isRunning === true ? "stale" : run.status;
			const tools = !stale && Array.isArray(run.currentTools) ? run.currentTools.map((tool) => tool && tool.name).filter(Boolean) : [];
			const step = !stale && run.currentStep && typeof run.currentStep === "object"
				? "turn " + String(run.currentStep.turn ?? "?") + " / step " + String(run.currentStep.step ?? "?")
				: (running ? "步骤未知" : "无进行中步骤");
			const lastAge = stale ? null : run.lastEventAgeMs;
			const tokenText = usage === null
				? "未上报"
				: fmtTokens(usage.totalTokens);
			const cacheRead = usage === null ? "未知" : fmtTokens(usage.cacheReadTokens);
			const cacheWrite = usage === null ? "未知" : fmtTokens(usage.cacheWriteTokens);
			const input = usage === null ? "未知" : fmtTokens(usage.uncachedInputTokens);
			const output = usage === null ? "未知" : fmtTokens(usage.outputTokens);
			const statusLine = stale && run.isRunning === true
				? "状态已过期或连接中断：不显示为运行中"
				: run.statusLine;
			const rows = [
				React.createElement("div", { className: "drm-head", key: "head" },
					React.createElement("span", { className: "drm-chip", "data-status": status }, statusLabel(status)),
					React.createElement("span", { className: "drm-kv" }, (run.provider || "?") + " / " + (run.model || "?")),
					React.createElement("span", { className: "drm-muted" }, "用时 " + fmtDuration(run.durationMs))),
				statusLine ? React.createElement("div", { className: "drm-line", key: "line" }, statusLine) : null,
				row("工作区", workspaceName(run.cwd), undefined),
				row("当前工具", tools.length > 0 ? tools.join(" + ") : "无", undefined),
				row("步骤", step, undefined),
				row("最近活动", lastAge === null || lastAge === undefined ? "未知" : fmtAge(lastAge), undefined),
				row("token 累计", tokenText + " · 未缓存输入 " + input + " · 缓存读 " + cacheRead + " · 缓存写 " + cacheWrite + " · 输出 " + output, undefined),
				usage !== null && usage.partial === true
					? React.createElement("div", { className: "drm-warn", key: "partial" }, "用量仍在累计或存在缺失，不是最终值")
					: null,
				usage !== null && usage.complete === false && usage.partial !== true
					? React.createElement("div", { className: "drm-warn", key: "incomplete" }, "用量不完整")
					: null,
				run.finishedAt ? row("结束于", fmtClock(run.finishedAt), undefined) : null
			].filter(Boolean);
			return React.createElement("div", { className: "drm-run", "data-status": status, key: run.sessionId || "run-" + index }, rows);
		}

		function fileBlock(file, stale) {
			if (file.error !== undefined) {
				return React.createElement("div", { className: "drm-run", "data-status": "error", key: file.file },
					React.createElement("div", { className: "drm-head" },
						React.createElement("span", { className: "drm-chip", "data-status": "error" }, "读取失败"),
						React.createElement("span", { className: "drm-kv" }, shortId(file.file))),
					React.createElement("div", { className: "drm-error" }, file.error));
			}
			const bridge = file.bridge || {};
			const runs = Array.isArray(file.runs) ? file.runs : [];
			const bridgeStale = bridge.stale === true || stale === true;
			const header = React.createElement("div", { className: "drm-bridge", key: (file.file || "bridge") + ":head" },
				React.createElement("span", null, "桥 " + shortId(bridge.instanceId)),
				React.createElement("span", { className: bridgeStale ? "drm-bridge-state drm-stale" : "drm-bridge-state" },
					bridgeLabel(bridge, bridgeStale) + (bridge.heartbeatAgeMs === null || bridge.heartbeatAgeMs === undefined ? "" : " · 心跳 " + fmtAge(bridge.heartbeatAgeMs))));
			const runNodes = runs.length === 0
				? [React.createElement("div", { className: "drm-muted", key: "empty" }, "此桥暂无任务")]
				: runs.map((run, index) => runCard(run, bridgeStale || stale, index));
			return React.createElement("div", { key: file.file || bridge.instanceId }, [header].concat(runNodes));
		}

		function Panel() {
			const dataState = React.useState(null);
			const data = dataState[0];
			const setData = dataState[1];
			const errorState = React.useState(null);
			const error = errorState[0];
			const setError = errorState[1];
			const loadingState = React.useState(true);
			const loading = loadingState[0];
			const setLoading = loadingState[1];
			const openState = React.useState(false);
			const open = openState[0];
			const setOpen = openState[1];
			const refreshingState = React.useState(false);
			const refreshing = refreshingState[0];
			const setRefreshing = refreshingState[1];
			const lastOkState = React.useState(null);
			const lastOkAt = lastOkState[0];
			const setLastOkAt = lastOkState[1];

			const mountedRef = React.useRef(true);
			const timerRef = React.useRef(undefined);
			const inFlightRef = React.useRef(false);
			const runningRef = React.useRef(false);
			const abortRef = React.useRef(undefined);
			const loadRef = React.useRef(null);
			const scheduleRef = React.useRef(null);

			scheduleRef.current = () => {
				if (timerRef.current !== undefined) clearTimeout(timerRef.current);
				const hidden = typeof document !== "undefined" && document.hidden === true;
				const delay = hidden ? POLL_HIDDEN_MS : (runningRef.current ? POLL_RUNNING_MS : POLL_IDLE_MS);
				timerRef.current = setTimeout(() => {
					timerRef.current = undefined;
					if (loadRef.current) loadRef.current();
				}, delay);
			};

			loadRef.current = () => {
				if (inFlightRef.current) return;
				inFlightRef.current = true;
				const controller = new AbortController();
				abortRef.current = controller;
				const timeoutId = setTimeout(() => {
					if (abortRef.current === controller) controller.abort();
				}, FETCH_TIMEOUT_MS);
				if (mountedRef.current) setRefreshing(true);
				callApi(controller.signal).then((result) => {
					if (!mountedRef.current) return false;
					if (result && result.ok && result.value) {
						setData(result.value);
						setError(null);
						setLastOkAt(Date.now());
						const files = Array.isArray(result.value.files) ? result.value.files : [];
						runningRef.current = files.some((file) => file && file.bridge && file.bridge.state === "running"
							&& file.bridge.stale !== true
							&& Array.isArray(file.runs) && file.runs.some((run) => run && run.isRunning === true));
						return true;
					}
					setError((result && result.error && result.error.message) || "状态读取失败");
					runningRef.current = false;
					return false;
				}).catch((e) => {
					if (mountedRef.current) {
						const message = controller.signal.aborted
							? "状态请求超时或已取消"
							: String(e && e.message ? e.message : e);
						setError(message);
					}
					runningRef.current = false;
					return false;
				}).then(() => {
					clearTimeout(timeoutId);
					inFlightRef.current = false;
					if (abortRef.current === controller) abortRef.current = undefined;
					if (!mountedRef.current) return;
					setLoading(false);
					setRefreshing(false);
					scheduleRef.current();
				});
			};

			React.useEffect(() => {
				mountedRef.current = true;
				if (loadRef.current) loadRef.current();
				const onVisibility = () => {
					if (timerRef.current !== undefined) {
						clearTimeout(timerRef.current);
						timerRef.current = undefined;
					}
					if (typeof document !== "undefined" && document.hidden === true) {
						scheduleRef.current();
					} else if (loadRef.current) {
						loadRef.current();
					}
				};
				if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", onVisibility);
				return () => {
					mountedRef.current = false;
					if (abortRef.current !== undefined) {
						abortRef.current.abort();
						abortRef.current = undefined;
					}
					if (timerRef.current !== undefined) clearTimeout(timerRef.current);
					timerRef.current = undefined;
					if (typeof document !== "undefined" && document.removeEventListener) document.removeEventListener("visibilitychange", onVisibility);
				};
			}, []);

			const files = data && Array.isArray(data.files) ? data.files : [];
			const unavailable = error !== null;
			let active = 0;
			if (!unavailable) {
				for (const file of files) {
					if (!file || !file.bridge || file.bridge.stale === true) continue;
					if (Array.isArray(file.runs)) active += file.runs.filter((run) => run && run.isRunning === true).length;
				}
			}

			const toggleLabel = active > 0
				? "DSH 任务：" + active + " 个运行中，打开任务运行状态"
				: "DSH 任务：无运行中任务，打开任务运行状态";
			const toggle = React.createElement("button", {
				className: "drm-toggle",
				type: "button",
				title: "DSH SDK 任务状态（独立于桌面当前聊天）",
				"aria-label": toggleLabel,
				"aria-expanded": open,
				onClick: () => setOpen((value) => !value)
			},
				React.createElement("span", { className: active > 0 ? "drm-dot" : "drm-dot drm-dot-idle" },
					"DSH",
					active > 0 ? React.createElement("span", { className: "drm-count" }, String(active)) : null));

			let popup = null;
			if (open) {
				const body = [];
				body.push(React.createElement("div", { className: "drm-title", key: "title" },
					React.createElement("span", null, "DSH 任务运行状态 ", React.createElement("small", null, "SDK 任务，不是桌面聊天")),
					React.createElement("button", {
						className: refreshing ? "drm-refresh drm-spin" : "drm-refresh",
						type: "button",
						title: "刷新",
						onClick: () => {
							if (timerRef.current !== undefined) {
								clearTimeout(timerRef.current);
								timerRef.current = undefined;
							}
							if (loadRef.current) loadRef.current();
						}
					}, "↻")));
				body.push(React.createElement("div", { className: "drm-muted", key: "meta" },
					(latestTime(lastOkAt) === null ? "尚未读取" : "更新于 " + latestTime(lastOkAt))));
				if (error !== null) body.push(React.createElement("div", { className: "drm-error", key: "error" }, "读取失败：" + error));
				if (loading && data === null) {
					body.push(React.createElement("div", { className: "drm-muted", key: "loading" }, "加载中…"));
				} else if (files.length === 0) {
					body.push(React.createElement("div", { className: "drm-muted", key: "empty" }, "暂无 DSH 任务状态"));
				} else {
					body.push(React.createElement("div", { key: "files" }, files.map((file) => fileBlock(file, unavailable))));
				}
				popup = React.createElement("div", { className: "drm-popup" }, body);
			}

			return React.createElement(React.Fragment, null,
				toggle,
				popup === null ? null : ReactDOM.createPortal(popup, document.body));
		}

		function latestTime(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
			try {
				return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
			} catch (e) {
				return new Date(ms).toISOString();
			}
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("sidebar.footer.action", () => slots.register(
				{ name: "sidebar.footer.action", id: "dsh-run-monitor", order: 21, label: "DSH 任务运行状态" },
				Panel
			));
		}

		const inject = ["slots", "connection"];
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
