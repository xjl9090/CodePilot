> 创建时间：2026-06-21
> 最后更新：2026-06-21
> 状态：📋 待用户审定（未开工）

# Desktop Pet（桌面宠物）

## 1 / 来源与定位

用户已在 `~/.codepet/` 自行做了一个 Swift 原生宠物（CodePet.app），跟着 `~/.xjlpilot/codepilot.db` 与 `~/.codepilot/codepilot.db`（mtime 较新者）变表情。这次的目标是**在 xjlPilot 内置一份等价能力**，让宠物作为 xjlPilot 的"助手"概念出场，跟主进程同生同死、设置集中、形象由用户上传。

**不动外部 Swift 宠物**：不修改 `~/.codepet/`、不 kill 它、不写检测提示。两边各自独立；用户同时打开就同屏，是用户行为决定，不是我们要拦的事。

## 2 / 用户已确认的决策

| # | 决策 | 出处 |
|---|---|---|
| D1 | 状态集合：`idle / working / waiting / done` 共 4 种 | 用户答 |
| D2 | 素材存储：文件系统按主题分目录 + DB 存主题列表与当前选中 | 用户答 |
| D3 | 启动默认：**关**，设置面板里手动开 | 用户答 |
| D4 | 外部 Swift 宠物：不动 | 用户澄清 |
| D5 | 重构 vs 新增：在 xjlPilot 内**新增**功能，不依赖 ~/.codepet | 用户答（"是 B"）|

## 3 / 状态机定义

宠物状态由主进程**轮询当前 xjlPilot 自己的 db**得出（绝不读 ~/.codepilot），每 2 秒 tick 一次。

```
working   ：存在 chat_sessions.status='active' 且 (runtime_status='running'
            AND runtime_updated_at 30 分钟内) 或 messages.created_at 10 分钟内有该 session 的活动
waiting   ：当前 chat_sessions 最后一条 message.role='assistant'，且 60 秒内没有新 user 消息
            （理解为"等用户接茬"，对应原 Swift 宠物 thoughtBubbles 状态）
done      ：上一 tick 是 working，本 tick 不是 working —— **触发后维持 5 秒** 然后回 idle
idle      ：以上都不满足
```

5 秒 done 是为了让用户实际看到"完成"动画一眨眼而非闪过；维持期间状态机锁定，新 working 进来才能打断。这个是我从原 Swift 宠物 `celebrating` 状态推断的语义。

**关于 waiting**：原 Swift 宠物的 waiting 判定是 PetState 内部维护的；我借同样的语义但用 SQL 实现。如果发现误报（比如用户主动取消的会话被算成 waiting），后续在 db 里看一下 `runtime_status` 的实际终态再调整——这个先按上面定义做一版，再看效果。

## 4 / 模块清单（新增 / 改动）

| 模块 | 文件 | 新/改 | 说明 |
|---|---|---|---|
| DB schema | `src/lib/db.ts` | 改 | 新建 `pet_settings`、`pet_themes` 表 + migration（参照已有 'Ensure xxx table exists' 模式）|
| 主进程 - 宠物窗口 | `electron/main.ts` | 改 | 新增 `createPetWindow()`、生命周期与主窗口绑定、拖动持久化 |
| 主进程 - 状态轮询 | `electron/main.ts` | 改 | 新增 `petStateTicker`：每 2s 查 db → IPC 推到 PetWindow |
| Preload IPC | `electron/preload.ts` | 改 | 暴露 `petAPI.onState`、`petAPI.savePosition`、`petAPI.toggleMute` |
| 渲染 - 宠物页面 | `src/app/pet/page.tsx` | 新 | 透明背景，根据状态显示 PNG，简单 CSS 动画 |
| 渲染 - API：主题 | `src/app/api/pet/themes/route.ts` | 新 | GET 列表、POST 新建、DELETE |
| 渲染 - API：主题激活 | `src/app/api/pet/themes/[id]/activate/route.ts` | 新 | POST 切换当前主题 |
| 渲染 - API：素材 | `src/app/api/pet/asset/route.ts` | 新 | GET 返回本地文件（PetWindow 用，绕过 file:// 跨域）|
| 渲染 - API：上传 | `src/app/api/pet/themes/[id]/upload/route.ts` | 新 | multipart/form-data，校验 PNG，落 ~/.xjlpilot/pet/{id}/expr-{state}.png |
| 渲染 - API：设置 | `src/app/api/pet/settings/route.ts` | 新 | GET/PUT enabled / position / muted |
| 渲染 - 设置面板 | `src/components/settings/PetSection.tsx` | 新 | 总开关、主题列表（缩略图 + 切换 + 删除）、新建主题表单 |
| 设置导航 | `src/components/settings/nav-config.ts` | 改 | 加一项 |
| i18n | `src/i18n/en.ts`、`src/i18n/zh.ts` | 改 | `pet.*` 文案 |
| 文档 | `docs/handover/desktop-pet.md`、`docs/insights/desktop-pet.md` | 新 | 完工后产出（CLAUDE.md 要求）|

**不改**：i18n .bak / 旧 db.ts 迁移路径 / Sentry / Linux desktop 文件 / 任何已有 IPC handler 名字。

## 5 / DB schema

```sql
CREATE TABLE IF NOT EXISTS pet_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 用 KV 形式而非单行多列：以后加字段不用迁移
-- 已知 keys：enabled / current_theme_id / pos_x / pos_y / muted

CREATE TABLE IF NOT EXISTS pet_themes (
  id TEXT PRIMARY KEY,            -- slug，由用户输入的 name 转 kebab-case；用作目录名
  name TEXT NOT NULL,             -- 用户可见的名字
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 是否完整：4 张图都到位才算 complete；不完整的主题不能被激活
  is_complete INTEGER NOT NULL DEFAULT 0
);
```

**为什么 KV 不是单行多列**：`pet_settings` 这种"全局唯一一组开关 + 位置"的东西，未来肯定会加字段（如 size、opacity、auto-hide），KV 化省一次次迁移。`pet_themes` 是真正的 row-per-entity，正常表设计。

**自动播种（migration 时一次性插入）**：

- `pet_settings` 默认 `enabled=0`、`muted=0`、`pos_x/pos_y=null`（首次显示时主进程算屏幕右下角）
- `pet_themes` 不预置默认主题。第一次打开设置面板时显示"还没有任何主题，新建一个吧"的引导卡片，强制用户先建一个再打开开关——这避免"开了开关但没图，弹个空白方块"的体验

## 6 / 文件系统布局

```
~/.xjlpilot/
├── codepilot.db
└── pet/
    ├── default-dragon/                ← {theme-id}
    │   ├── expr-idle.png
    │   ├── expr-working.png
    │   ├── expr-waiting.png
    │   └── expr-done.png
    └── my-cat/
        ├── expr-idle.png
        ├── expr-working.png
        ├── expr-waiting.png
        └── expr-done.png
```

**约束**：

- 文件名固定为 `expr-{state}.png`（不允许用户改）
- 仅接受 PNG（mime check + magic byte check）
- 单图大小上限 5MB（主进程拒接更大；UI 提示）
- 主题 id 由 name 转 slug（小写、ASCII、空格转 -、非法字符过滤）；冲突时尾部加 `-2`、`-3`
- 删除主题时先反激活（如果是 current）→ 删 db row → 删目录

## 7 / IPC 协议

```ts
// electron/preload.ts → window.petAPI
type PetState = 'idle' | 'working' | 'waiting' | 'done';
interface PetStatePayload {
  state: PetState;
  themeId: string | null;            // null = 没主题
  assetUrl: { idle: string; working: string; waiting: string; done: string } | null;
  muted: boolean;
}

petAPI.onState(cb: (p: PetStatePayload) => void): void;        // 主推渲染
petAPI.savePosition(x: number, y: number): Promise<void>;       // 拖动结束时调
petAPI.toggleMute(): Promise<{ muted: boolean }>;                // 点击宠物时调
petAPI.requestQuit(): void;                                     // 上下文菜单退出
```

**主窗口侧也用得到**（用于设置面板预览即将切换的主题）：

```ts
petAPI.previewTheme(themeId: string): Promise<void>;            // 临时切换主题图给宠物窗口（不改 db）
petAPI.commitTheme(themeId: string): Promise<void>;             // 真切换（改 db）
```

## 8 / Electron 主进程

### 8.1 创建宠物窗口

```ts
// electron/main.ts
let petWindow: BrowserWindow | null = null;

function createPetWindow() {
  if (petWindow) return petWindow;
  petWindow = new BrowserWindow({
    width: 220, height: 220,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,                    // 不抢焦点（防止从主窗口切走）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  petWindow.setIgnoreMouseEvents(false);  // 默认接收点击；拖动/点击区可控
  petWindow.loadURL(`${baseUrl}/pet`);
  petWindow.on('closed', () => { petWindow = null; });
}
```

### 8.2 状态轮询

`petStateTicker` 在主进程持有；不在主窗口/渲染。每 2s tick；只在 petWindow 存在时跑：

```ts
setInterval(async () => {
  if (!petWindow) return;
  const state = inferPetState();          // 走 better-sqlite3 同步查
  petWindow.webContents.send('pet:state', payload);
}, 2000);
```

复用 `getDb()` 里的 better-sqlite3 连接，不再起 sqlite3 子进程。这是和原 Swift 宠物（用 `sqlite3 CLI` 子进程）的本质差异——更快、更稳。

### 8.3 生命周期

- xjlPilot 启动 → 读 `pet_settings.enabled`，true 才创建宠物窗口
- 主窗口关闭 → 宠物窗口跟着关
- 设置里关闭开关 → 关宠物窗口（保留 db row）
- 设置里打开开关 → 创建宠物窗口（首次取屏幕右下角；之后从 db 取 pos_x/pos_y）

## 9 / 渲染层

`src/app/pet/page.tsx`：

- 全屏透明 div
- 根据 IPC 推来的 state，切换显示对应 `assetUrl[state]` 的 `<img>`
- CSS 动画（不用 Framer Motion，避免 bundle 膨胀）：
  - idle：上下浮动 4px / 周期 3s
  - working：缓慢旋转光环（CSS keyframes）
  - waiting：3 个点轮播
  - done：放大 1.1x → 1x，opacity 闪一下，附加 sparkle CSS 粒子
- 整个 div 设 `-webkit-app-region: drag`，子元素（图本身）设 `-webkit-app-region: no-drag`，单击 = mute toggle，右键 = 上下文菜单
- 拖动结束 → `petAPI.savePosition`

主题切换时：监听 `pet:state` 推来的 `assetUrl`，整段图源换成新主题。

## 10 / 设置面板

`PetSection.tsx`：

```
┌─────────────────────────────────────────────────────┐
│ 桌面宠物                                              │
│ [开关]                                               │
│                                                     │
│ 当前主题：my-cat ▼   [新建主题]                       │
│                                                     │
│ ┌─ 主题：my-cat ──────────────────────────────────┐  │
│ │ [idle 缩略] [working 缩略] [waiting 缩略] [done] │  │
│ │ [✓ 设为当前] [删除]                              │  │
│ └─────────────────────────────────────────────────┘  │
│                                                     │
│ ┌─ 主题：default-dragon ─────────────────────────┐    │
│ │ ...                                            │    │
│ └────────────────────────────────────────────────┘    │
│                                                     │
│ [重置宠物位置]                                        │
└─────────────────────────────────────────────────────┘
```

新建主题对话框：

```
名字（必填）：[__________]
idle 状态图（必填）：[选择文件] (.png ≤ 5MB)
working 状态图（必填）：[选择文件]
waiting 状态图（必填）：[选择文件]
done 状态图（必填）：[选择文件]
[取消] [创建]
```

**全部 4 张到位才能创建**——避免半成品主题。

## 11 / 验收 checklist（开发完成时跑）

按 CLAUDE.md "语义验收"和"反例 smoke" 节，每条必须实测：

- [ ] V1 默认关：全新数据库 + 重装 → 启动后 dock 没有宠物窗口
- [ ] V2 开了但无主题：设置里打开开关 → 不出现宠物窗口；提示"先创建主题"
- [ ] V3 创建主题：上传 4 张 PNG → 文件落到 `~/.xjlpilot/pet/{id}/` → DB 里有 row → 自动激活 → 宠物窗口出现
- [ ] V4 状态切换：发一条会话 → 宠物在 2-4s 内变 working → 等 assistant 回复完 → 变 done 5 秒 → 回 idle
- [ ] V5 拖动持久化：拖到屏幕左上 → 重启 xjlPilot → 出现在左上同位置
- [ ] V6 mute：点击宠物 → muted 变化保存到 db
- [ ] V7 切换主题：上传第二套图 → 设置里点切换 → 宠物图换了，db `current_theme_id` 也变
- [ ] V8 删除主题：删除 current 主题 → 自动回退到 idle 占位 + 关闭开关；删除非 current → 仅删除
- [ ] V9 主窗口关闭 → 宠物窗口同时关闭
- [ ] V10 反例：~/.xjlpilot/codepilot.db 损坏（手工把 db 改名）→ 主进程不崩，宠物窗口显示 idle 占位
- [ ] V11 反例：把 `~/.codepilot/codepilot.db` 设为 mtime 最新（敲文件）→ 内置宠物**仍只跟着 xjlpilot 走**（确认未串库）
- [ ] V12 反例：把一张图换成 1×1 像素 PNG → 宠物窗口正常加载，不留崩溃 trace
- [ ] V13 typecheck：`npx tsc --noEmit` 通过
- [ ] V14 单测：`npm run test` 通过

V11 是关键反例——**它直接对应你最初最关心的"两个 db 不能串"**。

## 12 / 风险与权衡

| 风险 | 缓解 |
|---|---|
| 宠物窗口与原 Swift 宠物同屏 | D4 决策接受。文档（handover）里说明：两者读不同 db 路径选择逻辑；同屏是用户行为 |
| 透明 + alwaysOnTop 在某些 Linux WM 表现不一致 | 这次只重点验证 macOS（你只在 mac 上用）；Windows/Linux 后期再说，task 不阻塞 |
| 拖动 IPC + position 持久化在多显示器下可能滑出屏 | 启动时 clamp 到当前可见 displays 的 workArea 内 |
| 用户上传的 PNG 实际是其他格式但扩展名 .png | magic byte 校验（前 8 字节 = `89 50 4E 47 0D 0A 1A 0A`）|
| 主进程 db 查询如果太慢拖累 ticker | 限制查询为 2 条 SQL（active sessions + 最近 messages），都有索引；超时（>500ms）就跳过本 tick 写日志 |
| Electron 透明窗口 macOS bug：vibrancy 与 transparent 冲突 | PetWindow 不开 vibrancy，纯 transparent + backgroundColor 透明 |
| `focusable:false` 时 macOS 上拖动可能怪 | 实测；如果出问题改为 `focusable:true` 但加 `setAlwaysOnTop` 确保不抢主窗口 |

## 13 / 决策日志

- 2026-06-21: 状态集合定 4 个，启动默认关，多主题切换。理由见 §2 用户答。
- 2026-06-21: 不改 ~/.codepet/。两个宠物各读各的 db 路径选择逻辑，xjlPilot 内置只读 ~/.xjlpilot/，用户行为决定是否同屏。
- 2026-06-21: 用 better-sqlite3 同步查代替 sqlite3 CLI 子进程（原 Swift 宠物方式）。比子进程快一个量级、不会泄露 fd。
- 2026-06-21: pet_settings 用 KV 表而非定列表。理由：未来加字段不需要 migration。
- 2026-06-21: done 状态强制持续 5 秒。理由：原 Swift 宠物 celebrating 也是定时退出，UX 上需要"看得到的完成"。

## 14 / 完工产出

按 CLAUDE.md 要求：

- `docs/handover/desktop-pet.md` — 技术交接（schema、IPC、文件布局、状态机）
- `docs/insights/desktop-pet.md` — 产品思考（为什么是宠物不是状态栏图标，用户希望有"陪伴感"，参考的外部产品）
- 反向链接到本计划

## 15 / 待用户确认事项（非阻塞，但 §11 验证前需要明确）

1. 状态机里 **done 维持 5 秒** OK 吗？还是 3 秒、10 秒？
2. **多显示器** 下，pet 应该跟主窗口跑还是停留原位？我倾向"停留原位，启动时 clamp 到可见区"。
3. 你提到"上传几张图"——只有 PNG 还是要支持 JPG/GIF？我倾向只 PNG（透明背景才好看；GIF 会引入帧率问题）。
4. 设置面板入口位置：你想要"独立 PetSection"还是"放在 Appearance 下面"？我倾向独立。

确认这 4 个之后我就开干 Phase 1。
