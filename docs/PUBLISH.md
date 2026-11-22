# 发布到 GitHub

这个目录已经是一个 git 仓库（一个初始提交），可以直接推到 GitHub。

## 1. 改包名（可选，但建议）

本地安装用的名字是 `@local/dsh-watch-together`。公开发布时建议改成不带 `@local` 的名字，
这样别人能直接：

```json
{ "dependencies": { "dsh-watch-together": "github:YuYuesangzi/dsh-watch-together" } }
```

改三处：

- `package.json` 的 `name`
- `client.js` 第一行 `window.__ModuleLoader__.load({ id: '@local/dsh-watch-together' ... })`
  的 `id` 必须和 `package.json` 的 `name` 一致
- `cordis.patch.yml` 里的 `name: '@local/dsh-watch-together'`

> 改名前先在本机确认新名字装得上；改完后原来的本地安装要重新装一次。

## 2. 推到 GitHub

```bash
cd dsh-watch-together
git branch -M main
git remote add origin git@github.com:YuYuesangzi/dsh-watch-together.git
git push -u origin main
```

没有 SSH key 就用 HTTPS：

```bash
git remote add origin https://github.com/YuYuesangzi/dsh-watch-together.git
```

## 3. 发布前检查

- [ ] `node --check index.js client.js overlay.js` 全部通过
- [ ] 不含本机绝对路径（本仓库只有 `~/.dsh/watch` 与 `127.0.0.1:9222`）
- [ ] `LICENSE` 里的年份/署名改成你的
- [ ] `README.md` 里的安装步骤在本机跑过一遍
- [ ] `package.json` 的 `files` 覆盖所有运行文件（index/client/overlay/patch/locale/docs/icon/README/LICENSE）

## 4. 别人怎么装

本地目录（最简单）：

```
设置 → 内置插件 → 添加插件 → 选中仓库目录 → 重启 DSH
```

或者用 plugin_manager：`install_bundle`，target 是目录绝对路径。
