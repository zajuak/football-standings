# 校内服务器独立版

这是可部署到自有服务器的完整积分榜工具，使用 Node.js + SQLite。它直接复用 `cloudflare/records-api.mjs`、历史合并和快照校验逻辑，网页和接口通过同一端口提供。

校内入口为 `http://10.129.83.25:8080/`。首次复制原网站的完整历史后，校内副本与 GitHub Pages / Cloudflare 原站**分别维护，不互相同步**。校内多人访问同步到服务器 SQLite；原站继续使用 D1，入口和数据库配置不改变。页面保留原有编辑口令。

此前只有只读迁移副本。默认启动仍是只读 API；要启用完整独立版，明确设置 `READ_ONLY=false` 及 `STATIC_DIRECTORY`。不得把普通 Pages 构建部署成校内版，否则浏览器仍会连接 Cloudflare。

## 运行

运行环境为 Node.js 24 LTS 和 Python 3，不依赖 npm 扩展。已有测试同时覆盖 Node.js 22 和服务器安装的 Node.js 24。

```bash
DATABASE_PATH=/absolute/path/standings.sqlite READ_ONLY=true PORT=8080 node server/main.mjs
```

完整校内版：

```bash
npm run build:campus
DATABASE_PATH=/absolute/path/standings.sqlite READ_ONLY=false \
  STATIC_DIRECTORY="$PWD/campus-dist" PORT=8080 node server/main.mjs
```

`npm run build` 仍生成连接 Cloudflare 的 `pages-dist/`；`npm run build:campus` 单独生成 `campus-dist/`，接口是 `/api/records`，健康检查是 `/health`。HTTP 校内地址没有 Web Crypto 时，口令和历史导入使用兼容的 SHA-256 实现，哈希和提交编号保持一致。

- `GET /health`：数据库状态、主库/副本模式、历史条数、当前有效版本及最后一条记录编号。
- `GET /api/records`：最新有效快照。
- `GET /api/records?history=1&full=1`：原始完整历史，保留冲突快照，按 `next` 分页。
- `GET /api/records?history=1&distinct=1`：相邻重复版本合并后的历史视图，原始记录不删除。
- `GET /api/records?revision=123`：某个原始版本。
- 只读模式拒绝所有 POST；只有显式设置 `READ_ONLY=false` 才接受写入。

配置静态目录后提供网页及公开资源，禁止目录穿越和跨目录符号链接，不会公开 SQLite、环境文件或服务器源码。浏览器默认仅允许同源请求；额外允许的来源可通过 `ALLOWED_ORIGINS` 配置。原有后端无需身份验证的策略保持一致。

## 持久化与服务

服务使用独立的 `football-standings` 系统账号，数据库目录权限为 700、数据库文件为 600；源码和 Node.js 运行时由 root 持有。

| 路径 | 用途 |
|---|---|
| `/opt/football-standings/current` | 当前网站和后端版本的符号链接 |
| `/opt/football-standings/runtime/bin/node` | 校验官方 SHA-256 后安装的独立运行时 |
| `/var/lib/football-standings/standings.sqlite` | 校内独立数据库，SQLite WAL + FULL 同步 |
| `/var/backups/football-standings` | 独立可恢复的 SQLite 备份 |
| `/etc/football-standings.env` | 监听地址、端口、数据路径与只读模式 |

仓库内的 `.service` 和 `.timer` 文件提供自动启动、异常重启及每日在线备份。数据库路径独立于发布目录，因此更新或重启服务不会重置历史。

```bash
sudo systemctl status football-standings
sudo systemctl list-timers football-standings-backup.timer
sudo systemctl start football-standings-backup.service
sudo journalctl -u football-standings -n 30
```

备份通过 SQLite backup API 读取在线 WAL 数据库，切换为独立文件并完成完整性检查后原子发布。可以将备份文件另外复制到其他机器。

## 从 D1 迁入或补齐记录

以下导出应在有 Cloudflare 权限且能访问 Cloudflare 的维护电脑上执行。导出和数据库文件必须保存到私有目录，不能提交到 GitHub。

```bash
node node_modules/wrangler/bin/wrangler.js d1 export football-standings \
  --remote --table submissions --config cloudflare/wrangler.jsonc \
  --output /private/backup/export.sql --skip-confirmation

python3 server/prepare-export.py /private/backup/export.sql /private/backup/new.sqlite
```

转换命令拒绝覆盖已有文件，并输出记录数、最新有效版本、逐行内容摘要及文件 SHA-256。传到服务器并校验文件摘要后，在**只读副本**上运行：

```bash
sudo -u football-standings /opt/football-standings/runtime/bin/node \
  /opt/football-standings/current/server/import.mjs \
  /var/lib/football-standings/migration-source.sqlite \
  /var/lib/football-standings/standings.sqlite
```

源文件需先设置为该账号可读的 600 权限。导入使用事务，保留原始版本号、提交编号、有效/冲突状态、时间、快照原文和内容哈希。重复导入不重复新增；相同编号对应不同内容时整批回滚，不覆盖已有数据。显式导入旧版本号后，后续新版本仍从最大编号继续增长。

导入后应逐条比对全部字段、分页核对历史、验证最新有效快照，并立即生成新备份。只读迁移阶段可重复补齐；独立站开始编辑后不再混合导入另一站记录，以免版本号冲突。两站没有自动同步。

## 更新独立站

先运行测试及两个构建，将 `campus-dist/`、`public/`、`cloudflare/` 和 `server/` 放入新的 `/opt/football-standings/releases/<version>/`。先在线备份数据库并保留旧配置、unit 和 `current` 目标，再原子切换 `current`，重启服务并核验 `/health`、全部资源和数据。不覆盖或重新初始化已有 SQLite。健康检查失败时恢复原配置和旧 `current`，不要删除数据库。

独立版配置示例（`/etc/football-standings.env`，root 600）：

```ini
HOST=0.0.0.0
PORT=8080
DATABASE_PATH=/var/lib/football-standings/standings.sqlite
BACKUP_DIR=/var/backups/football-standings
READ_ONLY=false
ALLOWED_ORIGINS=
STATIC_DIRECTORY=/opt/football-standings/current/campus-dist
```

## 验证

```bash
node --test tests/*.test.mjs
```

服务器新增测试覆盖真实 HTTP 读写、只读保护、请求上限、跨重启持久化、原始历史完整迁入、事务回滚和在线备份恢复。写入验收只使用临时数据库，不向迁移副本或原 Cloudflare 主库写测试赛果。
