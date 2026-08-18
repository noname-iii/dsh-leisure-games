# DSH-Leisure-Games

[![dsh.so security](https://www.dsh.so/badges/dsh-leisure-games.svg)](https://www.dsh.so/artifact/dsh-leisure-games/)

> 一个运行在 **DeepSeek Harness（`dsh`）网页客户端**里的休闲游戏插件。
> 源码托管在 GitHub：[noname-iii/dsh-leisure-games](https://github.com/noname-iii/dsh-leisure-games)。
> 本文件是**面向任何一台新机器的安装手册**（macOS / Windows / Linux），
> 所有命令都可直接复制。

DSH 网页客户端的休闲游戏插件：安装后在侧边栏「新会话」与「工作区」之间展示
**DSH-Leisure-Games** 按钮，点开是四个选项卡：

| 选项卡 | 内容 |
|---|---|
| **Tetris - 俄罗斯方块** | 横屏版俄罗斯方块（源自 `1.俄罗斯方块_L2` 的网页版，默认 20 宽 × 10 高） |
| **Nsnake - 贪吃蛇** | 默认 20×10 地图：3 格蛇、5 食物、5 障碍，方向键/WASD 转向，穿墙循环 |
| **Leiting Wuziqi - 技能五子棋** | 默认 15×15，棋子落在横竖线交界处，可执黑/执白，AI 可选弱/中/强，双方各带 6 种技能（每方每局限 2 次） |
| **Minesweeper - 经典扫雷** | 经典扫雷规则：默认 20×30 棋盘、17 颗雷；左键翻开、右键插旗、首点安全 |

其余内置能力：

- **游玩时长限制**（默认开启 30 分钟）：到点提示「不能再玩了，休息一下吧」并强制回到主页，60 分钟后自动重置；可在设置中开关并调整时长。**计时在游戏过程中持续进行（含暂停、结束画面），只有退出游戏返回主页或关闭面板时才停止。**
- **设置面板**：时长限制开关/时长；**外观（菜单按钮颜色自定义，侧边栏按钮与面板主色同步；开始菜单游戏入口文字颜色自定义，四个游戏入口卡片文字与侧边栏按钮文字同步）**；贪吃蛇的地图行数/列数、速度、食物数、障碍数、初始长度、背景音乐（本地上传）、背景图片（本地上传）；五子棋的棋盘行数/列数、AI 实力、背景音乐、背景图片；扫雷的地图行数/列数、雷的个数、背景音乐、背景图片；以及「退出游戏」。
- **每个游戏都有退出入口**（顶栏「返回主页」/ 五子棋、俄罗斯方块内 Q 键 / 贪吃蛇 Esc），退出即**停止计时**。
- **进度与设置持久化**：退出游戏、关闭面板、刷新页面都会保留所有设置与当前进度（蛇身/棋盘/方块堆/扫雷盘面），计时停止。旧版本保存的状态会**自动迁移**到当前结构（缺失的键补默认值，用户已有的设置与进度保持不变）。
- **AI Agent 事件提醒（左上角）**：游戏中若工作区 AI 请求批准操作，弹出窗口显示**项目名、详细信息、运行的命令**与「运行 / 不运行」按钮；AI 完成项目时弹出完成提醒。点击卡片即关闭游戏面板并跳回该项目的 AI Agent 界面。
- **持久化状态安全加固**：localStorage 与同源其他插件共享，视为不可信输入。加载时对全部持久化数据做**白名单消毒**——媒体只接受 `data:image/*` / `data:audio/*` 的自包含 base64 数据 URL（杜绝 `url(...)` CSS 注入与外部资源加载），颜色必须是 `#rrggbb`，所有数值字段与四游戏进度快照都夹取到合法区间（防止超大棋盘/数组导致卡死），超大的异常负载直接重置为默认值；运行时四个设置 action 同样对上传媒体做二次校验。

## 目录结构

```
dsh-leisure-games/
├── README.md                本文件（安装手册）
├── verify-e2e.ts            浏览器端到端验证脚本（四个游戏全流程 + 颜色自定义）
├── verify-notifications.ts  浏览器端 AI 批准/完成提醒验证脚本
├── repro-old-state.ts       旧版本持久化状态回归探针（验证迁移修复）
├── plugin/                  插件包源码（dsh bundle 本体）
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsdown.config.ts
│   ├── src/
│   │   ├── index.ts         node half（空 apply）
│   │   ├── invariant.ts     包不变量伴生
│   │   └── client/
│   │       ├── index.ts     浏览器 half：注册侧边栏按钮 + 全屏面板
│   │       ├── hub-store.ts 持久化中心状态（设置/时长/四游戏进度）
│   │       ├── security.ts  持久化数据白名单消毒（媒体/颜色/数值/快照）
│   │       ├── GameHub.tsx  主页面：四个选项卡、设置、休息横幅
│   │       ├── SettingsPanel.tsx
│   │       ├── SidebarButton.tsx
│   │       ├── Notifications.tsx  AI 批准/完成事件左上角提醒
│   │       ├── audio.ts     背景音乐 hook
│   │       ├── locales.ts   zh/en 字典
│   │       └── games/
│   │           ├── tetris/     引擎 + 组件（横屏俄罗斯方块）
│   │           ├── snake/      引擎 + 组件（贪吃蛇）
│   │           ├── gomoku/     引擎 + 组件 + 六大技能 + 三档 AI
│   │           └── minesweeper/ 引擎 + 组件（经典扫雷）
│   └── tests/               7 个 vitest 套件（64 个用例）
├── LICENSE
└── .gitignore
```

---

## Download

Latest release: **v0.2.0** — published on GitHub Releases with an offline tarball
asset `dsh-leisure-games-0.2.0.tgz`:
https://github.com/noname-iii/dsh-leisure-games/releases/latest

```bash
git clone https://github.com/noname-iii/dsh-leisure-games dsh-leisure-games
cd dsh-leisure-games
```

or install straight from GitHub / npm / the release tarball as a `dsh` bundle:

```bash
dsh plugin --profile web add github:noname-iii/dsh-leisure-games
dsh plugin --profile web add dsh-leisure-games                    # npm package
dsh plugin --profile web add ./dsh-leisure-games-0.2.0.tgz       # offline (release asset)
```

The repository ships prebuilt `lib/` artifacts — no dependencies or TypeScript
needed to use it. Cloning/downloading to any directory works as-is.

## Install (DeepSeek Harness)

Recommended: install as a bundle, then start. Replace `<plugin-dir>` with the
path to this plugin (after `cd dsh-leisure-games` you can just use `.`):

```bash
dsh plugin --profile web add "<plugin-dir>"   # e.g. dsh plugin --profile web add .
dsh web
```

Or mount without installing: edit `examples/web-overlay.yml`, replace
`<插件绝对路径>` with the absolute path to this plugin (Windows requires the
`file:///D:/...` form; macOS/Linux use a plain absolute path), then:

```bash
pnpm dsh web --patch "<plugin-dir>/examples/web-overlay.yml"
```

---

## 玩法说明

### 贪吃蛇

- 开局蛇长 3、方向向上、持续前进；方向键或 WASD 转向，**按一次转一格**，不可 180° 掉头。
- 撞到上下左右边界会从对侧同行/同列出现（穿墙）。
- 吃食物 +1 长度并 +10 分（食物会补一颗）；撞障碍或自己的身体则死亡。
- `P`/空格 暂停，回车 重开，`Esc` 返回主页。

### 技能五子棋（每方每局最多使用 2 次技能）

- 默认 15×15 棋盘，**棋子落在横线与竖线的交界处**（正方形格点）；选边后黑先；
  五连（含以上，横/竖/斜）获胜；无法落子为平局。
- 己方回合可先选一个技能再落子（对方刚用过技能的回合，己方不能再用技能）。
  1. **点穴** — 连续下两步棋。
  2. **倒反天罡** — 双方互换棋子颜色（棋盘棋子不变，下一步仍轮到对方）。
  3. **改头换面** — 把棋盘上一颗对方棋子变成己方。
  4. **雷霆大脚** — 清空一整行/一整列/一整条对角线（含己方棋子）。
  5. **何意味** — 己方落子后，对方下一步由系统随机落子，且对方该轮不能再动。
  6. **偷袭** — 移走对方任意一颗棋子。
- AI 实力：弱 = 随机带少量防守；中 = 单层启发式；强 = 深度 2 对抗搜索（攻防兼备，会主动用技能防守/进攻）。AI 的指导原则（显示在面板上）：
  「你是一位高超的棋手，你不想被对手打败，你要竭尽所能打败对手，利用好技能，利用好规则。」

### 经典扫雷

- 默认 20 行 × 30 列、17 颗雷；与经典扫雷规则一致：左键翻开、右键插旗/取消旗、
  右键已翻开的数字可快速翻开周围（chord）、**首次点击必然安全**（点击后才布雷，
  并避开点击处及其周围 8 格）、翻开雷即失败并亮出所有雷、翻开全部安全格获胜。
- 设置里可改地图行数/列数与雷的个数。

### 俄罗斯方块

- 横屏棋盘（默认 20×10），经典 7-bag、踢墙旋转、锁定延迟、暂存、投影。
- 键位：←→/AD 移动，↓/S 软降，↑/W 旋转，Z 反向，空格硬降，C/Shift 暂存，
  P/Esc 暂停，R 重开，M 音乐，Q 返回主页；游戏内自带设置面板
  （背景图/音乐/音量/压暗/速度/地图/形态/网格/投影）。

## 游玩时长模型

- 计时在**游戏过程中持续进行**（进入游戏即开始，暂停、死亡、结算画面都不停）；
  **只有退出游戏返回主页或关闭面板时才停止计时**。
- 累计达到上限（默认 30 分钟）→ 提示「不能再玩了，休息一下吧」并回到主页；
  从达到上限起 **60 分钟**后自动重置累计时长。
- 设置里可关闭限制或修改时长（1–600 分钟）。

## 测试

> 测试需在 DSH 仓库内运行（因为测试依赖 DSH 的 vitest 配置与工作区依赖）。

```bash
cd deepseek-harness
pnpm exec vitest run packages/client/ui-leisure-games
```

覆盖：贪吃蛇引擎（移动/穿墙/进食/死亡/掉头规则）、五子棋引擎（胜负判定、
六大技能、技能互锁、次数上限、何意味随机回合、AI 三档）、方块引擎
（旋转/消行/暂存/游戏结束/快照序列化）、扫雷引擎（默认形态/首点安全/洪泛
翻开/插旗/胜负/chord/序列化）、时长限制状态机（30 分钟拦截、60 分钟重置、
开关、暂停不停表）、持久化状态迁移（旧结构补默认值、幂等、容错）、外观
（菜单按钮颜色与游戏入口文字颜色的校验与默认值）、安全消毒（非 data URL /
外部协议媒体与 CSS 注入载荷被拒、超大棋盘/异常数值被夹取、超大负载重置为
默认值、`__proto__` 原型键被忽略）、浏览器注册（插槽注册/卸载级联/共享 store/
面板交互/AI 批准与完成提醒卡片）。另有 `verify-e2e.ts` / `verify-notifications.ts`
两个真实浏览器端到端脚本。

## 验收证据（真实浏览器，DSH web 127.0.0.1:3080）

- 单元测试：**74/74 通过**（`pnpm exec vitest run packages/client/ui-leisure-games`）。
- `verify-e2e.ts`：**33/33 通过** —— 侧边栏按钮位于「新会话」与「工作区」之间；
  四个选项卡齐全；贪吃蛇暂停/退出正常；五子棋「规则：连续五子」与 AI 人设文案可见、
  **棋盘格为正方形（boardFrame 宽高差 < 2px）且棋子居中落在横竖线交界处**；
  AI 落子与技能面板正常；俄罗斯方块键位与退出正常；扫雷默认 20×30 共 600 格、
  首点安全、右键插旗正常；设置面板分区齐全；**外观颜色自定义（菜单按钮颜色与
  游戏入口文字颜色均持久化并应用到侧边栏按钮、面板主色与游戏入口卡片文字）**；
  退出游戏返回聊天界面。
- `verify-notifications.ts`：**6/6 通过** —— 左上方批准卡片显示项目名/详细信息/
  「运行」「不运行」按钮，点「运行」后卡片消失；完成提醒卡片点击返回 AI Agent。
- `repro-old-state.ts`：**通过** —— 旧版持久化状态（缺扫雷设置）自动迁移后，
  进入扫雷不再崩溃回主界面（修复：打开扫雷跳回主界面的 bug）。

## 安全与发布

- **持久化安全模型**：localStorage 与同源其他插件共享，一律按不可信输入处理。
  实现集中在 `plugin/src/client/security.ts`，在加载迁移、store action、媒体
  使用点三处校验（纵深防御）。
- **发布**：源码托管在 [noname-iii/dsh-leisure-games](https://github.com/noname-iii/dsh-leisure-games)
  （带 `dsh-plugin` topic）。插件注册表 [dsh.so](https://www.dsh.so) 会对
  GitHub 上的 DSH 插件做自动安全扫描（依赖/权限/密钥/供应链）；提交后详情页
  显示扫描结果（L1–L5 校验等级 + Security 扫描）。
