# Cloudflare 云端历史存档

前端继续托管在 https://zajuak.github.io/football-standings/ 。
后端为用户自己账号的 `football-standings-api` Worker，绑定现有 D1 数据库 `football-standings`，变量名为 `DB`。

## 数据与权限

`migrations/0001_history.sql` 追加创建 submissions 表，不删除现有记录。每次提交完整快照；历史不会被修改或自动清理。相同提交号的网络重试不会重复写入。过期页面的提交归档为冲突版本，不覆盖最新积分榜。

所有读写接口都要求 `Authorization: Bearer <SYNC_TOKEN>`。在 Worker Secrets 中设置至少 24 位的随机同步口令；口令不放入 GitHub、网页源码或 wrangler.jsonc。网页中输入口令后仅保存在当前页面内存，重新打开页面需要重新输入。知道口令的人可以查看并修改全部云端数据。

CORS 允许 https://zajuak.github.io 发起请求；CORS 不代替口令验证。`GET /health` 仅检查绑定与口令是否配置，不返回赛事数据。

## 部署

使用 Cloudflare 官方 Wrangler 登录自己的账号，然后执行：

```sh
npx wrangler d1 migrations apply football-standings --remote --config cloudflare/wrangler.jsonc
npx wrangler secret put SYNC_TOKEN --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

如已有 Wrangler 安装，也可以直接运行其入口。数据库 ID 来自用户创建的数据库详情页，部署前必须确认属于当前登录账号。

也可以在 D1 Console 执行迁移 SQL，随后在 Worker 编辑器部署打包代码，并保留 DB 绑定。部署后检查 `/health`，以及未带口令访问 `/api/records` 返回 401。

## 前端使用

1. 在“云端同步”输入口令并连接。
2. 首次迁移选择“上传本机全部历史”：逐条归档本机所有快照，保留原时间，最后将当前积分榜保存为云端最新版本。失败后可以再次上传续传，旧快照按原提交号去重。
3. 其他设备选择“读取云端最新数据”。本机原版本始终保留在本机历史中。
4. 上传或读取完成后，当前页面的后续编辑自动同步；断网时保留待同步队列，重连后补传。首次仅连接不会自动替换任何积分榜。
5. “历史提交与备份”可选择查看和导出本机或云端历史。

迁移期间会暂时锁定编辑，防止导入过程中发生新的修改。云端容量仍受 Cloudflare 计划限制，建议定期导出完整历史备份。
