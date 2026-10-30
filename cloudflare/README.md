# Cloudflare 云端历史存档

前端：https://zajuak.github.io/football-standings/ 。
后端：用户自己账号的 `football-standings-api` Worker，绑定 D1 数据库 `football-standings`，变量名 `DB`。

## 数据与接口

`0001_history.sql` 创建追加式历史表；`0002_content_hash.sql` 添加内容哈希列，不改写或删除旧快照。旧记录不必回填，也参与内容比对。

`GET /api/records` 返回最新有效版本，`?history=1` 分页查询全部历史（包括冲突及导入档案），`?history=1&full=1` 包含快照，`?revision=N` 返回指定版本。每页 50 条，使用返回的 `next` 作为 `before` 游标继续导出。

`POST /api/records` 提交完整快照和提交 ID、基准版本、操作说明。比较时忽略选中的赛事、格式版本与对象键顺序。内容相同返回 `unchanged: true`，不新增历史；提交 ID 重试不重复写入，SQL 内容哈希检查也防止并发相同快照重复入库。实际内容发生变化且基准过期时，保存为历史并返回 409，保留两个版本供用户选择。明确的 `archiveOnly` 历史导入保留全部快照。

按用户内部使用要求，所有数据接口无需身份验证。CORS 允许 `https://zajuak.github.io`，但不能阻止非浏览器读写。`GET /health` 仅报告数据库绑定与 `authenticationRequired: false`。旧的 SYNC_TOKEN Secret 即使仍存在也不再使用。

## 部署

Wrangler 登录自己的账号后执行：

```sh
npx wrangler d1 migrations apply football-standings --remote --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

先备份现有数据库，再应用迁移，最后部署 Worker。数据库 ID 须属于当前登录账号。前端继续通过独立 GitHub 仓库的 Pages 工作流发布。

打开页面自动读取云端，后续仅实际内容变化才提交。断网修改留在本机待同步队列中，重连后补传；其他设备更新会在页面空闲时自动拉取。历史导入与冲突处理期间暂停编辑，避免覆盖未提交内容。完整历史可从网站导出备份，数据库容量受 Cloudflare 计划限制。
