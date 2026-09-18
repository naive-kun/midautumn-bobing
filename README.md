# 月满博饼 · 中秋小游戏

一个可在浏览器试玩、包含抖音小游戏入口的本地首版。Blender 制作陶瓷碗与圆角凹点骰子，服务器使用 Bullet 真实模拟六骰碰撞，所有玩家观看同一轨迹。最多12人含房主，轮流投掷；可一人练习。

## GitHub Pages 单人试玩

[打开单人试玩](https://naive-kun.github.io/midautumn-bobing/)

公开试玩版直接在浏览器的 Web Worker 中运行同一套 Bullet 物理，不需要房间服务器。支持选择轮数、自由投掷、瓷碗碰撞音效及逐轮奖项回看，暂不开放多人联机。刷新页面会结束本次试玩。

```bash
npm ci
npm run build:pages
npm run preview:pages
```

本地访问 http://127.0.0.1:5181 。`build:pages` 自动启用单人模式，资源使用相对路径，支持仓库子目录；也可通过 `VITE_BASE_PATH` 指定路径。网页完整产物位于 `dist/web`。

GitHub 仓库的 **Settings → Pages → Source** 选择 **GitHub Actions**。推送到 `main` 后，`.github/workflows/pages.yml` 自动运行测试、构建并部署。仅上传 `dist/web`，不运行服务器、付费服务或数据库。

## 现在试玩

```bash
cd midautumn-bobing
npm install
npm run dev
```

打开 http://localhost:5178 。填昵称、创建房间，其他浏览器窗口输入房间码加入；所有在线玩家点击准备后，房主开始。相同局域网的手机可打开终端显示的 Network 地址。房间最多12人，开局锁定名单。

本轮开发已安装依赖并启动预览。`npm run dev` 同时运行前端5178、房间服务器8796；不要重复启动占用同一端口的实例。Ctrl+C 结束这两个服务。

## 已实现

- 实际 Blender 模型：白瓷内壁、绿釉外壁、金边、带凹点的圆角骰子。
- Bullet 刚体：骰间、碗底及碗壁真实碰撞；朝上面判点；异常不暗改结果。
- 12席建房/房间码加入、准备、轮流投、按轮记录奖项、喜报、固定娱乐版规则。
- 断线保留60秒，房主转交；投掷已受理后继续结算；重连补轨迹。
- 超时跳过；无效投掷明确重试，连续3次无效跳过。
- 越权操作和重复结算保护；连接/房间/物理任务队列有上限。
- 网页桌面/竖屏布局，音效与规则弹层；抖音Canvas界面与SocketTask适配。

## 模型源文件

- `blender/midautumn-bobing.blend`：真实Blender可编辑工程。
- `blender/model-preview.png`：Blender渲染预览。
- `public/models/bowl.glb`、`die.glb`：浏览器和小游戏实际加载的模型。
- `public/models/manifest.json`：尺寸、坐标和面值约定。
- `scripts/build_models.py`：可复现建模脚本。使用独立后台进程，不操作用户当前打开的场景：

```bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --python scripts/build_models.py
```

## 验证

```bash
npm test
npm run verify:multiplayer
npm run build
```

- `npm test`：32项通过，包含高处释放取景、100次真实物理投掷、46,656种点数组合穷举、单人停稳后判奖/异常重试以及 Pages 子路径配置。
- 固定100个种子的物理测试：94次有效、6次斜立并明确要求重投；未发现飞出、穿底、最终骰子相互重叠或物理超时。此结果只代表这组本机测试。
- 新版释放高度4.65–5.0（原2.65–2.9）；同批种子平均过程2.77→3.65秒，实际碰撞声音事件15.89→19.57次。对比证据 `artifacts/physics-height-comparison.json`。
- `verify:multiplayer`：真实12个独立客户端完整投一轮；逐次核对12端轨迹哈希、结果及最终成绩，并测试第13人被拒和投掷者断线重连。最新证据在 `artifacts/multiplayer-verification.json`。
- 原有本地联机网页已通过实际界面操作：创建→准备→开始→投掷→结算→重开→离房。检查1280桌面、390×844竖屏与浏览器错误日志。新增单人模式已通过自动化逻辑测试、Worker 构建验证及公网资源检查；本次浏览器控制工具不可用，尚未完成线上逐按钮验收。
- 抖音入口已在本地API适配测试页走通同样的单人流程，错误日志为空。这不等于抖音开发者工具或真机验证。

## 抖音工程

`npm run build` 输出：

- `dist/web`：网页静态构建。
- `dist/douyin`：可导入抖音开发者工具的小游戏目录。

目前小游戏构建默认连 `ws://127.0.0.1:8796/ws`，仅供本机开发；AppID留空，没有伪造ID。正式手机预览需要你自己的小游戏AppID和已部署的WSS服务：

1. 复制 `.env.example` 为 `.env`，填写 `DOUYIN_APP_ID`、`MINIGAME_SERVER_URL`。
2. 部署房间服务，配置HTTPS/WSS证书与抖音后台服务器域名。
3. 重新 `npm run build`。
4. 登录抖音开发者工具，导入 `dist/douyin`，进行安卓和iPhone真机测试。

本轮工具停在未登录页，因此尚未完成真正的抖音运行验证、上传或发布。没有购买云服务。

可用 `npm run preview:minigame` 启动 http://127.0.0.1:5180 的本地适配测试页；这是开发辅助工具，不随产品构建发布。

## 服务与持久化边界

开发默认使用临时内存房间，服务重启会清空房间及内存历史。配置 `MYSQL_URL` 后将结算记录写入MySQL，在线房间本身仍不支持服务重启恢复；MySQL真实连接尚未验证。没有使用其他数据库替代。

HTTP/WS路径、参数、返回值、字段映射与部署准备见 `docs/SERVER.md`；共享消息约定见 `docs/PROTOCOL.md`。每掷按固定规则取最高奖项，界面按轮记录所得，不显示累计积分或积分排名，不涉及现金奖品。协议中原有 `score` / `points` 暂保留兼容历史记录，界面不使用。

## 后续验收

完成抖音登录及AppID、WSS配置后，优先真机检查：模型加载、碰撞音效、连续投掷的流畅度、弱网和前后台切换。公开运营前还需平台登录身份接入、部署和数据恢复方案；目前的随机会话凭证用于本地原型身份与重连。
