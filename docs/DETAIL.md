# 陪看

一起看 B站视频。

## 它做什么

- 从本机调试 Edge（`--remote-debugging-port=9222`）读当前视频的真实播放进度（`video.currentTime`）
- 每轮把「你们正在看《片名》，放到 mm:ss / 暂停中」注入系统提示，所以聊剧情时它知道片子在哪儿
- 在画面右下角贴一条半透明小字（5 秒淡出、不挡点击）
- 提供工具：`watch_start` / `watch_status` / `watch_sync` / `watch_here` / `watch_stop`

## 怎么用

1. 用带调试端口的 Edge 打开 B站视频（本机可用 `msedge.exe --remote-debugging-port=9222 --user-data-dir=...`）
2. 对 Agent 说「一起看这个」或给它一个 B站链接 / BV 号 / 番剧 ep 链接
3. 播放、拖进度、暂停都会被读到；暂停时它知道你在暂停

## 限制

- 只支持 **B站网页播放器**；本地播放器、其它站点读不到
- 需要那个带 `--remote-debugging-port=9222` 的 Edge 窗口
- 只读本机 9222，不读 cookie，不碰其它标签页内容
- 不会让 Agent 主动发言（那需要往会话里塞提示，属于另一档开关）
