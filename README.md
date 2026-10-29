# 北大足协积分榜生成器

[在线使用](https://zajuak.github.io/football-standings/) · [GitHub 仓库](https://github.com/zajuak/football-standings)

纯静态 GitHub Pages 网站，支持男足新生杯和女足北大杯的赛果录入、修改、删除，红黄牌和纪律扣分、同分排序、球队/小组管理，以及 SVG / PNG 积分榜海报导出。

## 数据保存

- 当前积分榜缓存在 localStorage，每次保存的完整快照追加到 IndexedDB。
- 不自动删除历史或截断条数；删除赛果、恢复初始数据、恢复历史版本都会保留之前的快照。
- “历史与备份”可以分页查看并恢复旧版本、导出当前数据、导出所有历史和待存档提交。
- 支持导入当前数据 JSON，也支持把完整历史备份中的全部快照导回另一个浏览器。
- 保存失败时保留待存档队列；重新打开页面会重试，避免重复追加同一笔提交。
- **所有记录只保存在当前浏览器，不会自动跨设备同步。** 浏览器存储受本机容量、清理操作和私密浏览生命周期影响，请定期导出完整历史备份。
- 旧版曾经覆盖掉的历史版本无法补回；旧版仍保存的当前数据可以导出 JSON 后迁移。

网站不连接云端数据库，不需要 ChatGPT 登录或访问密钥。原始 Word、用户在本机修改的赛果、历史记录和个人备份均不上传到 GitHub。

## 本地运行

要求 Node.js >= 22。没有第三方运行依赖。

```sh
npm test
npm run build
npm run dev
```

本地预览为 `http://127.0.0.1:8081/`，构建产物位于 `pages-dist/`。

## 项目结构

- `index.html`：编辑器页面
- `public/app.mjs`：页面交互和备份导入/导出
- `public/core.mjs`：积分、排名和赛果逻辑
- `public/local-history.mjs`：IndexedDB 全量历史快照和待存档队列
- `public/poster.mjs`：积分榜海报
- `public/styles.css`：页面样式
- `tests/`：积分规则和本机历史测试
- `scripts/build-pages.mjs`：构建静态发布目录
- `.github/workflows/pages.yml`：测试通过后发布 GitHub Pages

原维护目录中，`scripts/copy-editor.mjs` 可以同步父目录的原始源文件；独立克隆该仓库后，直接修改仓库中的源文件即可。

## 发布

推送 `main` 后 GitHub Actions 自动运行测试并发布到 GitHub Pages，无需服务器或运行时密钥。
