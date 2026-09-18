# 博饼房间服务

当前实现：Node.js HTTP + `ws` WebSocket；服务器调用 worker thread 中的真实 Bullet/Ammo 模拟，再统一广播轨迹和结算。客户端不提交骰子点数、物理种子、成绩或下一位玩家。

## 启动

```bash
cd midautumn-bobing
npm install
npm run server
```

默认监听 `127.0.0.1:8796`，避免占用本机已有的 8787 服务。`HOST`、`PORT` 可以覆盖。运行完整浏览器预览使用 `npm run dev`；Vite 会代理 `/ws` 和 `/api`。

## HTTP 接口

### `GET /api/health`

无请求参数。健康时返回 HTTP 200；数据库不可用、发生历史写入失败或正在关闭时返回 HTTP 503。

```json
{
  "status": "ok",
  "service": "midautumn-bobing",
  "maxPlayers": 12,
  "rooms": 1,
  "connections": 3,
  "storage": {
    "mode": "memory-temporary",
    "status": "ok",
    "durable": false,
    "writeFailure": false
  },
  "physics": { "active": 0, "queued": 0, "concurrency": 2 }
}
```

配置 MySQL 后 `storage.mode` 为 `mysql`；健康连接的 `durable` 为 `true`。`writeFailure` 一旦出现会保持为 `true`，提示运营者调查可能缺失的历史，不能仅因后续数据库连通就认为缺口已修复。其他 HTTP 路径返回 404，目前没有公开历史查询接口。

## WebSocket 接口

路径：`/ws`。本地为 `ws://127.0.0.1:8796/ws`；公网应通过 HTTPS 反向代理使用 `wss://自己的域名/ws`。

每条客户端消息是 JSON 文本：

```json
{ "type": "ready", "requestId": "随机前缀-递增编号", "payload": { "ready": true } }
```

`requestId` 必须是 1–80 字符字符串，跨连接也应唯一；重试同一操作时沿用同一编号。服务端回复：

```json
{ "type": "ack", "requestId": "随机前缀-递增编号" }
```

或：

```json
{ "type": "error", "requestId": "随机前缀-递增编号", "code": "NOT_YOUR_TURN", "message": "还没轮到你，请等待" }
```

部分房间级异步错误没有 `requestId`，例如 `PHYSICS_FAILED`、`ROOM_EXPIRED`、`PERSISTENCE_FAILED`，客户端应显示提示。`ack` 表示请求已受理；投掷结果须等待服务器的后续房间快照。

| type | payload | 行为及主要返回 |
|---|---|---|
| `hello` | `{token?: string}` | 必须首先调用。无 token 创建随机身份；有效 token 恢复身份，返回 `welcome`、房间快照和需要补播的轨迹。无效 token 返回 `INVALID_TOKEN`，不会接纳客户端自选身份。 |
| `create` | `{name: string, rounds?: number}` | 创建房间并成为房主。昵称裁至 20 个字符串字符；轮数 1–10，默认 3。返回 `room` 和 `ack`。 |
| `join` | `{name: string, roomCode: string}` | 六位数字房间码；仅大厅允许加入。包含断线保留席最多 12 人，超额 `ROOM_FULL`。 |
| `ready` | `{ready: boolean}` | 大厅准备/取消准备。 |
| `start` | `{}` | 房主发起，所有在线玩家须准备；支持一人练习。 |
| `roll` | `{}` | 仅当前回合在线玩家可投掷；服务器先锁定回合，再异步模拟。 |
| `leave` | `{}` | 主动释放席位，返回 `left`；必要时移交房主。已受理投掷仍结算。 |
| `reset` | `{}` | 房主仅在整场结束后调用；保留玩家，清空成绩/历史/准备状态，回到大厅。 |
| `ping` | `{clientTime: number}` | 返回 `pong` 的原 `clientTime` 与 `serverTime`，另回复 `ack`，用于估算时钟差。 |

`welcome`：

```json
{ "type": "welcome", "playerId": "随机UUID", "token": "64位随机十六进制凭证", "serverTime": 1790000000000 }
```

token 只发送给所属连接，不能分享到房间或日志。新连接携带同一 token 时替换旧连接，旧连接以 4001 关闭。

### 房间快照和前后端映射

外层为 `{type:'room', selfId, serverTime, room}`。客户端以收到的整份 `room` 替换本地状态；仅在服务器快照驱动下更新每轮奖项和回合。

| 后端字段 | 前端用途 |
|---|---|
| `selfId` | 识别本人的座位和操作权限 |
| `serverTime` | 估算服务器时间，校正轨迹播放与倒计时 |
| `room.code` | 六位数字房间码 |
| `room.hostId` | 房主标记、开始/再来一场按钮权限 |
| `room.phase` | `lobby` 大厅、`waiting` 等待投掷、`rolling` 计算/播放中、`finished` 整场完成 |
| `room.players[]` | `{id,name,seat,ready,connected,score}`；头像/昵称、准备、离线。`seat` 从 0 开始；`score` 仅保留兼容，界面不用。 |
| `room.round` / `totalRounds` | 当前轮数和总轮数 |
| `room.turnPlayerId` | 当前投掷者；本人且处于 `waiting` 才能投掷 |
| `room.turnDeadline` | 等待投掷截止时间，Unix 毫秒；非等待时为 null |
| `room.history[]` | `{id,playerId,playerName,round,values,award,invalid?}`；按 `round` 筛选、`playerId` 对应席位的每轮所得；保留所有重试记录 |
| `history[].values` | 六个实际点数。斜立等无效投掷可为 `[]`，超时跳过为 `[]`。 |
| `history[].award` | `{name,points,rank}`；界面展示 `name` 奖项名称；`points` 和 `rank` 保留协议兼容，不做积分排名 |
| `history[].invalid` | 无效或跳过原因，应直接展示 |
| `room.activeRoll` | null 或 `{id,playerId,startTime,duration}`；物理计算期间 `duration=0`，轨迹就绪后更新为真实时长 |

`left` 表示客户端应清除当前房间状态。hello 恢复身份后若原席位已过期或房间已销毁，也会主动发 `left`，避免保留旧画面。连接状态可与房间状态分别展示。

### 轨迹

广播 `{type:'trajectory', serverTime, roll}`：

```js
roll = {
  id, playerId,
  startTime, // Unix 毫秒，服务器预留 250ms 播放提前量
  duration,  // 毫秒
  frames: [
    { t: 0, dice: [[x, y, z, qx, qy, qz, qw], /* 共六颗 */] }
  ],
  impacts: [{ t: 0.4, strength: 0.8 }]
};
```

`frames[].t`、`impacts[].t` 使用秒，位置使用 Y 向上的共享坐标系；旋转为四元数。客户端按 `本机时间 + 服务器偏差 - startTime` 找到帧并插值，不独立重做物理。轨迹中不提前下发最终 `values`；服务器到播放结束时间才判奖并更新快照。重连补发活动轨迹或最近一次轨迹，已播放完的显示末帧。

## 轮次、容错与资源边界

- 最多 12 人，包括断线保留席；加入检查及占位同步完成，并发第 13 人不会挤入。
- WebSocket 协议级 ping 每 30 秒发一次；下一次检查未收到 pong 则终止失联连接，因此无 close 的断网通常在约 30–60 秒被发现。正常 close 立即标记离线。
- 标记离线后保留席位 60 秒，重连恢复；房主优先移交给在线玩家。保留席并不暂停游戏，等待投掷 30 秒超时会跳过。
- 服务器锁定已受理的投掷。投掷者掉线、离开或保留期到期，已经受理的结果仍会广播给留在房间的人。
- 斜立等物理无效结果零分记录，原玩家可再投；连续三次无效跳过本轮并在记录中说明。物理进程异常不扣次数、不计分、不自动换人，提示使用新操作编号重试。
- 相同 `requestId` 和相同请求重发，仅回复原结果；同一编号改参数返回 `REQUEST_ID_CONFLICT`。成功受理的投掷另行保留去重记录，普通心跳不会把它挤出缓存。
- 单条请求最大 4096 字节，超大消息以 1009 关闭；只接受 JSON 文本。每连接每 10 秒最多 40 条请求，超限 `RATE_LIMITED`。
- 每客户端发送缓冲超过 4MiB 时关闭慢连接，避免无限堆积轨迹。初次连接 10 秒内未 hello 会关闭。
- worker 默认最多 2 个并发、32 个排队，每次物理计算最多 45 秒。物理计算不占用网络主线程。
- 非投掷中的房间闲置超过 2 小时清理；离线且无房间的会话保留最多 24 小时。默认最多 1000 房间、12000 在线连接；这些是保护上限，不代表已完成同等规模负载测试。

## MySQL

未配置 `MYSQL_URL` 时使用**明确的临时内存模式**，重启会丢失房间和历史。不使用 SQLite 替代。

在 `.env` 配置自己的数据库地址，不提交真实密码：

```dotenv
HOST=127.0.0.1
PORT=8796
MYSQL_URL=mysql://bobing:替换为实际密码@127.0.0.1:3306/bobing
```

先在 MySQL 中创建 `bobing` 数据库及专用账号，密码中的 URI 特殊字符需 URL 编码。启动时使用 [server/schema.sql](../server/schema.sql) 自动执行 `CREATE TABLE IF NOT EXISTS`，账号需要建表和读写此表的权限。初始化失败会中止启动，不能默默回退为临时模式。

`bobing_rolls` 保存：投掷 ID、整场 ID、房间码、玩家 ID/昵称、轮数、实际点数 JSON、判奖 JSON、无效原因与入库时间。`roll_id` 主键防止重复写入；超时跳过也会记录。

**持久化边界：目前只保存逐次结算记录，在线房间、玩家令牌、准备状态和活动轨迹仍在内存。服务重启后不能恢复在玩的房间。** 多进程/多副本尚未实现共享房间状态，生产部署先使用单进程。数据库临时写入失败会通知房间并将健康状态标记为 degraded；当前没有自动补写队列或历史查询界面。

## 公网部署基础

以下是部署准备命令，项目开发过程没有自动开通服务器、购买域名或发布小游戏。使用支持当前项目的 Node.js 22.12+，先由完整依赖完成前端/小游戏构建，再部署服务端。

```bash
npm ci
MINIGAME_SERVER_URL=wss://自己的域名/ws DOUYIN_APP_ID=自己的AppID npm run build
npm run server
curl -f http://127.0.0.1:8796/api/health
```

正式运行应用进程应交给服务器的进程管理器守护，并从受保护的 `.env` 或环境变量加载凭证。`npm run server` 本身仅启动前台进程。

HTTPS 反向代理需要将 `/ws` 的 HTTP Upgrade 透传到 `127.0.0.1:8796`，并设置大于心跳周期的连接超时，例如 Nginx location：

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8796;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 90s;
}
location /api/ {
    proxy_pass http://127.0.0.1:8796;
    proxy_set_header Host $host;
}
```

TLS 证书、HTTPS server 块和静态页面托管须按自己的服务器配置。抖音端还需将真实 HTTPS/WSS 域名配置到平台允许的网络域名，并在开发者工具与真机分别验证；本地 `127.0.0.1` 地址不能供朋友的手机远程加入。

## 验证

```bash
node --test test/server.test.js
npm test
```

服务端 11 项集成测试覆盖：12 席并发上限和断线保留、越权、幂等投掷、重连同轨迹、结果不重复保存、受理后断线过期仍结算、三次无效跳过、等待超时、12 人完整轮转同结果、心跳冲刷缓存后的幂等性、物理异常恢复、无 close 断网、限流、消息大小、闲置清理、临时存储健康状态及过期重连清除旧房间。快速集成测试注入短轨迹；真实 Bullet 的统计测试在 `test/physics.test.js`，浏览器集成需另行验证实际轨迹渲染。

当前未对真实 MySQL 实例、公网 WSS、抖音真机、跨地区延迟或大规模负载做通过声明。
