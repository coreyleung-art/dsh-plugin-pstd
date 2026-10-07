# CHANGELOG · dsh-plugin-pstd

## 1.0.3

### ★ 修复：P2/P3 模板的「apply ↔ 冒烟」无界自递归（本次落盘最严重的缺陷）

模板生成的 `lib/index.js` 在 `apply()` 首行调 `runSelfCheck()`（**未 await**），而 `runSelfCheck()` 内部
`await mountSmoke()` 会 `import` 本入口再调 `apply()` —— 依赖一旦可解析，就形成**无界异步递归链**，
在真宿主里会把事件循环饿死（宿主挂死），而不是抛错。

**为什么三方检查都没抓到它（这是一条会撒谎的检查）**：

| 检查方式 | 结果 | 原因 |
|---|---|---|
| 生成物 `--selfcheck` | **pass** | CLI 末尾 `process.exit(await main(...))` 在链加深前就把进程连同后台链一起杀掉 |
| 生成物 `lib/selfcheck.js` 单测（首版） | 漏 | 当时 peer 解析失败，冒烟走 `skipped` 分支，根本没进 apply |
| 我的等价性指纹比对 | 无异常 | 模板与动态版逐字节一致 —— **忠实移植了一个忠实移植的缺陷** |

**抓出它的方式**：不经 CLI，直接调 `runSelfCheck()` 并让进程存活 2.5s。修复前该进程 **25s 超时未退出**
（微任务链饿死定时器）；修复后 13ms 完成、按时退出、`apply` 恰好进入 1 次。

**改法（双保险）**：
1. 模板生成的 `index.js` 传 `skipSmoke: true` —— apply 期只查 peer/符号，不跑冒烟；
2. `selfcheck.js` 内加模块级 `__smokeInFlight` 重入闸，重入时如实返回 `skipped` 并写明原因（不假装通过）。
冒烟本身不变，仍由 CLI `--selfcheck` / 宿主显式调用执行。

**已复测**：修复后生成物在「CLI 路径」与「活进程路径」下均 `smoke=pass`、依赖两项全 resolved、进程按时退出。

### ⑥ 版本单一来源修正

`lib/standard.js` 原先另写一处 `STD_ID = 'PSTD/1.0.2'`，与 `package.json` 的 `version` 构成**两处版本声明**
（R006 ⑥ 反例：两处声明必然漂移）。现改为从 `package.json` 派生：`STD_ID = 'PSTD/' + PKG_VERSION`。
注：审查器的 R6 项只识别 `VERSION = "x.y.z"` 形态，认不出 `STD_ID` 这种命名 —— **判据有形态盲区，已记入坑清单**。

### 其他修正

- **R2 证据显示自相矛盾**：原文把中英标记数相加后写成 `三段标记命中: 6/3`（6 个标记 / 3 个段）。
  改为**按段计数**（中英任一命中即该段覆盖），现显示 `三段覆盖: 3/3`。判据逻辑同步改为按段判定。

### 文档补充（坑清单 +3，均为本包作者当日实际踩到的错）

- 第 11 条 **声明面代替实测面**：把工具描述里的计数当实测报出，账本照抄。
- 第 12 条 **代理量代替实测量**：用「deps 只 +1」推出「5 项 bundle 无 deps 条目」并报出，逐项实测为假（真异常仅 2 项，且属历史正常模式）；已发更正卡撤回（`notes/mac-mini/pstd-mount-verify-20261006` v2）。
- 第 13 条 **会撒谎的检查（三条实证）**：`process.exit` 掩盖后台异步递归 / peer 解析失败掩盖真挂载 / 指纹等价只能证明移植忠实、不能证明被移植物本身正确。

## 1.0.2

落盘常驻插件包形态（由进程内动态插件移植），并修 5 个已登记缺陷 + 1 个移植中新发现的缺陷。

### 修复（对应缺陷清单 a–e）

- **a. `plugin_standard` 四个切片动作全部报错**：返回对象里带 `undefined` 值（`{ r006: undefined, patterns: undefined, ... }`），
  被 harness 的 lossless-JSON 校验拒 → `norms` / `r006` / `patterns` / `gates` 四个动作全废（只有 `all` 与 `selfproof` 能用）。
  **改法**：按 action 条件装配 payload，只挂上本次真正要返回的键，绝不出现值为 `undefined` 的字段。
- **b. 工具描述硬编码计数**：描述里写死「16 条负例」，运行时实测为 15 —— 描述与实测不一致，且该数字已被 R047 账本照抄。
  **改法**：描述不写任何条数；条数一律由运行时矩阵算出（`negativeCount` / `positiveCount` / `skippedCount`）。
- **c. N4 活体表唯一性误报**：已挂载插件自己的工具本来就在活体表里，却被当成「同名冲突」。
  **改法**：`plugin_name_gate` 新增可选参数 `selfTools`（字符串数组）——命中活体表但在 `selfTools` 中的名字只出
  `advisory`，**不计入冲突、不导致 ok=false**；不在 `selfTools` 中的仍是冲突。`audit` 保持只判形式。
- **d. `slugify` 截断落在词中**：旧版直接 `slice(0, 32)`，产出如 `plugin-naming-gate-and-review-wa`（半个词）。
  **改法**：按整段累加裁剪，装不下就丢弃该段；结果必须匹配 slug 正则，否则 `needsManual`。回归用例进 `--lean4-check` 正例矩阵。
- **e. 真挂载冒烟桩 ctx**：沿用动态版的递归 any-stub，四态如实分报（`pass` / `fail` / `skipped` / `timeout`），
  绝不把「依赖解析不到」报成插件缺陷。

### 移植 / 自验过程中新发现的缺陷（本次一并修掉）

- **自递归**：P2 骨架里 `apply()` 调 `runSelfCheck`，而冒烟又要 `import` 入口并调 `apply()` —— 一旦依赖可解析
  （本包已建好 node_modules 符号链接）就会无限递归。旧探针没暴露它，是因为当时 `@deepseek-ai/dsh-tools`
  解析失败、冒烟直接走了 `skipped` 分支。
  **改法**：`lib/selfcheck.js` 加递归闸（`smokeDepth`），重入时如实返回 `skipped` 并写明原因。
  ⚠ 该缺陷仍在**动态版**的 P2 模板里（`lib/templates.js` 逐字移植自动态版，未擅自改模板文本），属已知差异。
- **模块作用域的 execute 闭包抓不到 ctx**：首版把 5 个工具定义放在模块顶层，而 `execute` 引用 `apply(ctx)` 的参数
  → 表现为「注册成功、一调用就 `ReferenceError: ctx is not defined`」。
  **挂载冒烟只证明注册成功，不证明可调用** —— 这个坑是靠真调 execute 的宿主路径探针才抓出来的。
  **改法**：改为 `createDefinitions(ctx)` 工厂，在 apply 作用域内构造定义。
- **`stripNoise` 链式 replace 会吃掉代码**：原来是「先剥行注释、再剥字符串」的链式替换，
  于是字符串里的 `//`（如 `'// P1 宿主工具片段…'`）被当成注释起点，删掉该行尾引号、后续引号两两错配，
  把整段**代码**当字符串剥掉 → A 项假阳性、D/F 项找不到锚点。
  **改法**：重写为单遍字符扫描器（注释/字符串/模板串/正则一次过），正则字面量按前导字符判定。
- **自扫判据过宽（第三次「门太宽」）**：`\b(exec|spawn|fork)\s*\(` 会命中 `RegExp.prototype.exec(`
  （`/SMOKE:.../.exec(stdout)`、`re.exec(text)`），A 项因此误报 6 处。
  **改法**：自扫表改用精确信号（`child_process` 模块名 + `*Sync` 变体），审查别人的可疑表保持宽口径。
- **`process.exit` 不该计入 R10 红灯**：⑨ 要求固定退出码语义，Node 里就是 `process.exit(code)`；
  把它当危险原语会让任何合规 CLI 永远拿不到 R10 绿灯。
  **改法**：R10 把命中分为「真危险原语」与「CLI 退出码语义」两类分开报，后者不进红灯，
  同时如实标注「失败也 exit 0」文本判不出、需人工确认。`DANGER_PRIMITIVES` 表本身仍保持 8 条不变。
- **负例矩阵语义方向搞反**：入口/命令门靠「抛 GateError」表示拒绝，命名/工具名门靠「返回非空 issues」表示拒绝；
  首版把两者塞进同一个 try/catch，导致 11 条命名类负例全部误报 `rejected:false`。
  **改法**：负例统一改为布尔谓词「该越界输入是否确实被门拒绝」。

### 新增 / 变更

- **⑦ 统一日志落地**：`lib/log.js`，固定路径 `~/dsh-collab/logs/dsh-plugin-pstd.log`，append 写入；每次工具调用与
  每次 CLI 调用（**含失败与用法错误**）都落一条：时间 / 工具名 / 入参摘要 / 判断 / 结果摘要 / 诊断 / 耗时。
  写日志失败一律 try/catch 吞掉，绝不因日志失败让工具失败。
- **⑧ 自动落链**：`data/registry/dsh-plugin-pstd` 登记卡。
- **模块化拆分**：`lib/standard.js`（冻结标准单一来源）、`lib/naming.js`、`lib/fsops.js`、`lib/review.js`、
  `lib/scaffold.js`、`lib/templates.js`、`lib/log.js`、`lib/gate.js`、`lib/selfcheck.js`、`lib/index.js`。
- **删除 `lib/core.js`**：骨架占位内核在真实实现里没有角色，按「合并或删除，别留死代码」删除。
  （`lib/standard.js`、`lib/templates.js`、`lib/review.js`、`lib/fsops.js` 里仍出现 `core.js` 字样 ——
  那是**模板产物清单**与**审查别的插件时读取的文件名**，不是本包的运行时引用。）
- **`lib/gate.js` 的 A–F 从声明变成真检查**：A 真扫本包全部源文件（剥离注释/字符串/正则字面量）；
  D 真验 `fs.writeText` 调用点晚于 `dryRun` / `confirm` 两个门；F 真数出站调用点（恰好 1 处）并验命令逐字符比对冻结模板；
  E 真对 12 张冻结表做 `Object.isFrozen`。
- **`lib/index.js` 增加入口名一致性门**：注册定义的名字必须与 `standard.js` 的 `TOOL_NAMES` 逐字一致，否则 `apply` 直接抛错
  （R047 账本按 `plugin_name_gate` 引用执行点，改名即破坏账本）。
- **`lib/selfcheck.js` 冒烟新增断言**：不只是「文件能加载」，而是断言**恰好注册到那 5 个工具名**。

### 纠错复盘（有错就写这里，别改历史）

- v1.0.1 修的两处误判都是**我自己的门砍到自己人**，与 R006 坑#1「门太宽」同族。这轮 a / b / c 三处同族问题
  （返回 undefined、描述与实测不符、把自有工具当冲突）再次说明：**门的判据必须来自实测面，不是声明面**。
- 「16 条负例」这一错误数字的传播链：**工具描述（声明面）→ 交付卡 → R047 账本**，而运行时输出一直是 15。
  已在规范正文与账本复核卡里如实登记。

## 1.0.1

- **修 `patchRow`**：YAML 列表项写作 `- id: x`，旧正则只认行首 `id:`，导致全机命名审计 43/43 个插件**全部误报** `id = null`。
- **修命名审计 N4 误报**：审计把「本插件自己已挂载的工具」判为「与活体工具表同名冲突」——恰是 R006 坑#1 描述的
  「门太宽会砍掉自己人」。改法：审计只判形式；活体表唯一性只对**新名字**（check / allocate）有意义。
- 修后实测：`devices` 根 13 个插件 → 9 pass / 4 fail（4 个 fail 全是真实的 `.bak-*` 备份目录违规）。

## 1.0.0

- 由 PSTD 模式 `P2_bundled_plugin` 生成初始骨架。
- 含 R006 ①（形态 + 真挂载冒烟）、②（三段自检）、⑨（CLI 治理）、⑩（冻结枚举 + 负例矩阵 + 六项自证）。
- 骨架阶段 ⑦ 统一日志与 ⑧ 落链刻意为空 —— 骨架不代填业务路径与登记动作。
