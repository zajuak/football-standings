# 北大足协积分榜生成器

[网站](https://pku-football-standings.speedyfir135.chatgpt.site) · [GitHub](https://github.com/zajuak/football-standings)

支持男足新生杯与女足北大杯赛果录入/修改/删除、红黄牌及纪律扣分、积分排序、球队与小组管理，以及 SVG / PNG 积分榜海报导出。初始包含男足 16 场、女足 3 场比赛。

## 历史提交

- 使用 Cloudflare D1 保存完整数据快照，每次编辑保存追加新记录，无应用层自动清理或条数截断。
- 删除赛果、删除球队、恢复初始数据、恢复旧版都不会删除原来的历史快照。
- “历史与备份”可分页浏览、恢复任意版本、导出当前数据和导出完整历史 JSON；支持导入当前数据 JSON，或从完整历史备份中导入其当前积分榜。
- 离线提交先保存在本机队列；恢复网络后逐条上传，已同步记录可跨设备读取。请确认页面显示“已保存到云端”后关闭；浏览器存储满、清理本机数据或私密浏览可能影响尚未上传的数据。
- 提交号保证重试不会重复写入。多页面同时编辑时，过期版本会被归档并触发冲突提示；处理冲突前会归档所有待同步版本。
- 完整历史导出遍历全部分页，包含冲突快照和本机待同步队列。JSON 导入更新当前积分榜并产生一个新版本，不会重新导入原备份的所有历史记录。
- 网站更新不会重建或清空 D1 数据库。受托管平台容量和服务可用性限制，建议定期导出完整历史备份。

旧版只保留浏览器当前数据，已被覆盖的过去版本无法补回。不同网址不能直接读取彼此的 localStorage；需要通过 JSON 导出/导入迁移仍保留的数据。

## 隐私与访问

首次部署采用 Sites 默认的仅拥有者访问，依赖平台登录与访问控制保护共享数据及写接口。调整为公开访问前，需要增加独立的服务端编辑权限校验。

GitHub 仅包含代码、初始赛事数据、数据库结构和测试，不包含原始 Word、真实历史提交、数据库文件、环境密钥或凭据。

## 本地运行

要求 Node.js >= 22.13。

```sh
npm ci
npm test
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_history.sql
npm run dev
```

以 `drizzle/` 中实际生成的迁移文件名为准。迁移只需对每个本地数据库按顺序执行一次；本地数据库与线上数据库相互独立。

## 项目结构

- `editor.html`、`public/*.mjs`、`public/styles.css`：前端编辑器和图片生成
- `lib/server/records-api.mjs`：快照追加、并发检查、幂等提交及历史读取接口
- `app/api/records/route.ts`：云端 API 入口
- `db/schema.ts`、`drizzle/`：D1 表定义及版本化迁移
- `tests/`：积分规则与存档/同步测试
- `.openai/hosting.json`：Sites 项目标识与 D1 绑定，不存放密钥

前端核心源文件位于 `public/`。原维护目录中，构建脚本会优先同步父目录原有源文件；独立克隆该仓库时，直接使用仓库中已有源文件。

## 部署

网站使用 Sites + Cloudflare Worker + D1，不能作为纯静态 GitHub Pages 部署。保留 `.openai/hosting.json` 中已有项目 ID，可更新同一网站并保留数据库；托管构建使用保留的 Vinext / Sites 插件。数据库结构变化时先修改 `db/schema.ts`，执行 `npm run db:generate` 并提交生成的 SQL 和元数据，再通过 Sites 发布新版本。已应用迁移不能改写。
