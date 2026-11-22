# dsh-watch-together

Watch a Bilibili video together with your DSH agent.

公开仓库：<https://github.com/YuYuesangzi/dsh-watch-together>

It reads the **real playback position** from a local debug Edge window, tells the agent what you are
watching and where, and can show a quiet one-line overlay right on the video — draggable, visible in
fullscreen, and click-through when hidden.

```
浏览器（陪看模式 Edge）──CDP 9222──▶ Host 插件 ──┬─ 工具：watch_start / status / sync / here / stop / say
   video.currentTime                        ├─ 每轮注入「正在看什么、放到哪」
                                            └─ 画面小字（可拖动、全屏可见）
```

## Features

- **Real progress**: reads `video.currentTime` from Edge over the DevTools Protocol, every 2 s. Pause,
  seek and episode switches follow automatically.
- **Knows the title**: Bilibili video (BV), bangumi episode (`/bangumi/play/ep…`) or a season page
  (picks the episode that is actually playing by its player-title).
- **Agent context**: each turn receives a one-line note such as
  `你和用户在一起看《…》。正放到 12:31。`
- **Overlay line**: half-transparent text on the video, draggable, stays in fullscreen, disappears
  after a few seconds. Optional auto-comments (one short line at most every 30 s, generated from
  nearby danmaku) — off by one command.
- **Tools**: `watch_start`, `watch_status`, `watch_sync`, `watch_here`, `watch_stop`, `watch_say`.
- **Command**: `/watch start | stop | status | sync 15:20 | here | auto off`.
- **Settings page** in DSH: status card plus *start / stop / mute / unmute* buttons.

## Requirements

| Item | Notes |
|---|---|
| DSH | 0.2.2 or newer (Host + Web) |
| Windows / Edge | the debug window must run with `--remote-debugging-port=9222` |
| Bilibili | a normal `bilibili.com` video page with the HTML5 player |

Local video players, YouTube and other sites are **not** supported: the plugin reads one HTML5
`<video>` element over CDP.

## Install

1. Copy this folder somewhere stable, e.g. `D:\Plugins\dsh-watch-together`.
2. In DSH: **设置 → 内置插件 → 添加插件**，choose that folder. Or, with the plugin manager tool:
   `install_bundle` with the absolute folder path.
3. Restart DSH once so the settings page (client module) is loaded.
4. Open **设置 → 陪看** and click **开始陪看**.

### A debug Edge window

```bat
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USERPROFILE%\.dsh\edge-watch" ^
  https://www.bilibili.com
```

Use a separate `--user-data-dir` so it does not clash with your everyday Edge, and sign in to
Bilibili once in that window.

> The port only listens on `127.0.0.1`. The plugin reads the playback position and the player title;
> it does not read cookies or other tabs' content.

## Usage

```
你：一起看这个
AI： （调用 watch_start，读到 12:31）开始一起看《…》12:31。

你：现在看到哪了？
AI： 《…》看到 12:31 / 27:13（暂停中）

你：我拖到 15 分了
AI： （watch_sync 15:00）同步到 15:00 了。
```

Command line inside DSH:

```
/watch start      在调试 Edge 当前页开始陪看
/watch status     片名 / 进度 / 暂停
/watch sync 15:20 校准到 15:20
/watch here       当前弹幕/台词
/watch auto off   关掉自动吐槽（画面小字仍可手动 watch_say）
/watch stop       结束
```

## Overlay

- Position: bottom-right of the player container by default; **drag it** to move.
- Fullscreen: the element lives inside the player container, so it stays visible.
- Auto-hide: fades out after `seconds` (default 5).
- Click-through: it can be dragged, but it never covers the controls you use.

## Configuration

Environment variables, read at plugin load:

| Variable | Default | Meaning |
|---|---|---|
| `DSH_WATCH_PORT` | `9222` | DevTools port |
| `DSH_WATCH_AUTO` | on | `0` disables automatic comments |
| `DSH_WATCH_AUTO_MS` | `30000` | interval between automatic comments |

State file: `~/.dsh/watch/state.json`. Diagnostic log: `~/.dsh/watch/auto.log`.

## Limitations

- Bilibili HTML5 player only; no local files, no other sites.
- Automatic comments cost model tokens (one short call per comment). Disable with `/watch auto off`.
- The overlay is injected into the page; a page reload removes it until the next comment.
- Episode detection uses the player title; a page that hides it falls back to the episode link.

## Privacy

- Talks only to `127.0.0.1:9222` (local CDP) and public Bilibili endpoints (`api.bilibili.com`,
  `comment.bilibili.com`).
- Stores only `{title, bvid, cid, duration, startedAt, paused}` under `~/.dsh/watch/`.
- No credentials, no analytics.

## License

MIT — see [LICENSE](./LICENSE).

---

# 中文说明

## 它做什么

和 DSH 里的 AI 一起看 B站视频：从本机带调试端口的 Edge 读取真实播放位置，把「正在看什么、放到哪」告诉 AI，
并在画面上显示一条安静的小字（可拖动、全屏可见）。

## 装

1. 把本目录放到固定位置，例如 `D:\Plugins\dsh-watch-together`
2. DSH → 设置 → 内置插件 → 添加插件，选这个目录；或用 `install_bundle`
3. 重启一次 DSH（让设置页加载出来）
4. 打开「陪看模式 Edge」（`--remote-debugging-port=9222`），登录 B站，播放视频
5. 设置 → 陪看 → 开始陪看

## 用

```
/watch start | stop | status | sync 15:20 | here | auto off
```

或者直接跟 AI 说「一起看这个」「现在看到哪了」。

## 边界

只支持 B站网页播放器；自动吐槽会消耗模型 token（可以关）；本地播放器和其他网站读不到。
