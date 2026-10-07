// dsh-plugin-pstd · lib/standard.js
// 冻结标准（单一来源）：命名规范 N1–N8 / R006 十项 / 模式 P1–P5 / 门型 A–F / 命令白名单 / 危险原语表。
// 本文件只放数据与 deepFreeze，不放 IO 与判断逻辑。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⑥ 版本单一来源：标准身份不在此另写一处版本号，而是从 package.json 的 version 派生。
//    （此前 STD_ID 与 package.json version 是两处声明，属 R006 ⑥ 反例；2026-10-05 v1.0.3 修正。）
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const PKG_VERSION = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version
export const STD_ID = 'PSTD/' + PKG_VERSION

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

export const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const TOOL_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,3}$/
export const SLUG_MIN = 2
export const SLUG_MAX = 32
export const TOOL_MAX = 48
export const PLUGIN_PREFIX = 'dsh-plugin-'

// 本包真实入口枚举（5 个工具名）——R047 账本按 plugin_name_gate 引用执行点，故改名即破坏账本。
// 单一来源：lib/index.js 的注册定义与 lib/selfcheck.js 的期望值都从这里取。
export const TOOL_NAMES = deepFreeze([
  'plugin_standard',
  'plugin_name_gate',
  'plugin_review',
  'plugin_pattern_list',
  'plugin_pattern_scaffold',
])

export const NORMS = deepFreeze([
  { id: 'N1', title: '目录名', rule: '目录名 = ' + PLUGIN_PREFIX + '<slug>；slug 匹配 ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$，长度 ' + SLUG_MIN + '-' + SLUG_MAX + '（全小写 kebab-case，无点号/下划线/大写）', why: '本机 43 个插件目录里 39 个合规；点号会破坏目录枚举与黑板键，devices/ 下 4 个 dsh-plugin-x.bak-* 备份目录即为反例' },
  { id: 'N2', title: '包名', rule: 'package.json name === 目录名', why: 'R006 ⑥：标识与版本只允许一处声明（实测 dsh-plugin-agent-bus 的 name 仍写 dsh-plugin-agent-way、files 写 dsh-files）' },
  { id: 'N3', title: '插件行', rule: 'cordis.patch.yml 的 id === slug，name === package.json name（注意 YAML 列表项写作 "- id: x"）', why: '更名会留下 id/name 漂移；反例容忍度为零——这是无插件行则不可挂载的硬字段' },
  { id: 'N4', title: '工具名', rule: '匹配 ^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,3}$（snake_case，至少两段，首段=领域前缀），长度 ≤ ' + TOOL_MAX + '；新名字还须在活体工具表中唯一', why: 'R006 事故表记录「同名工具两处实现、行为不一致」造成认知分裂；注意唯一性只管新名字，已挂载插件自己的工具出现在活体表里是正常的' },
  { id: 'N5', title: '日志路径', rule: '~/dsh-collab/logs/' + PLUGIN_PREFIX + '<slug>.log', why: 'R006 ⑦：固定路径、失败也留痕' },
  { id: 'N6', title: '登记卡键', rule: 'data/registry/' + PLUGIN_PREFIX + '<slug>', why: '黑板 key 首段必须为纯小写字母（实测违规返回 400）' },
  { id: 'N7', title: '版本单一来源', rule: '版本只写在 package.json；CLI --tool-version 从它读取，不得第二处硬编码', why: 'R006 ⑥ 反例：两处声明必然漂移' },
  { id: 'N8', title: '保留字', rule: 'slug 不得为保留字（见 reservedSlugs）', why: '避免与宿主/框架命名空间撞车' },
])

export const RESERVED_SLUGS = deepFreeze(['dsh', 'plugin', 'plugins', 'cordis', 'agent', 'agents', 'tool', 'tools', 'test', 'tests', 'node', 'index', 'client', 'server', 'core', 'lib', 'api', 'new', 'default', 'config', 'app', 'sdk', 'main', 'bin', 'docs', 'runtime'])

export const R006_ITEMS = deepFreeze([
  { id: 'R1', grade: '①', name: 'dsh 插件形态', criteria: 'package.json(type=module/main/version/dsh.bundle.patch) + cordis.patch.yml 含 insert 行 + 入口导出 apply + 声明 client 时必须有真实 ./client 出口 + ★真挂载冒烟三态', fix: '补 package.json 必填字段 / 补 cordis.patch.yml / 补 apply 导出 / 补真挂载冒烟（pass·fail·skipped 三态分开报）' },
  { id: 'R2', grade: '②', name: 'TCC 能力边界自检', criteria: '--selfcheck 至少输出三段：能力清单 / 不该发生路径 / 依赖完整性', fix: '新增 lib/selfcheck.js 与 --selfcheck 旗标，输出三段' },
  { id: 'R3', grade: '③', name: 'CLD 自适应', criteria: '不 import 宿主私有路径；外部服务缺失时降级或拒绝而非崩溃', fix: '移除对宿主私有路径的引用，改为正式依赖 + 缺依赖降级分支' },
  { id: 'R4', grade: '④', name: 'dsh 版本自适应', criteria: 'peerDependencies 声明全部 peer；运行期不 import 未声明的内部模块', fix: '把 @deepseek-ai/* 全部写进 peerDependencies' },
  { id: 'R5', grade: '⑤', name: '文档化', criteria: '文档含 为什么需要/用法与退出码/达标矩阵/坑/复现命令，且路径写入 package.json r006.documented', fix: '补 docs/README.md 与 r006.documented' },
  { id: 'R6', grade: '⑥', name: '版本管理', criteria: '版本单一来源（CLI 从 package.json 读，无第二处硬编码）+ CHANGELOG 记录变更与纠错', fix: '删除源码内第二个版本常量；补 CHANGELOG.md' },
  { id: 'R7', grade: '⑦', name: '统一日志', criteria: '固定路径 ~/dsh-collab/logs/<tool>.log；每次动作含 时间/输入/判断/结果/诊断；失败也留痕', fix: '按固定路径落日志，失败分支也要写' },
  { id: 'R8', grade: '⑧', name: '自动落链', criteria: 'RULES.md 规则号（若定义规则）+ data/registry/ 登记卡 + 长文档入知识库', fix: '补黑板登记卡 data/registry/<slug>（写后必须回读确认）' },
  { id: 'R9', grade: '⑨', name: 'CLI 治理', criteria: '严格参数（未知旗标 exit 2）+ 退出码 0/1/2 固定语义 + --dry-run 零变更 + 机器可读输出 + --help 自解释', fix: '补严格参数解析、退出码语义、--dry-run 与机器可读输出' },
  { id: 'R10', grade: '⑩', name: '约束前置·不可绕过', criteria: '四型门（类型锁/入口门/Schema 门/状态机）之一 + --lean4-check 六项 A–F 自证全绿', fix: '补冻结白名单与负例矩阵，并让门不通过时拒绝执行' },
])

export const PATTERN_IDS = deepFreeze(['P1_host_tool', 'P2_bundled_plugin', 'P3_cli_tool', 'P4_host_client', 'P5_review_remediate'])

export const PATTERNS = deepFreeze({
  P1_host_tool: {
    id: 'P1', name: '宿主工具（会话内动态 Cordis 插件）', kind: 'inline',
    use: '只需在当前进程内生效的临时能力：查表、校验、生成、编排。进程重启即消失，不留盘。',
    artifacts: ['code.host 片段（交给 cordis_define）'],
    gate: 'Schema 门（object 节点必须写 additionalProperties，否则 UNSUPPORTED_SCHEMA 挂不上）+ 命名门 N4',
    verify: ['cordis_define（语法校验）', 'cordis_run 后调用一次正例', '调用一次负例，确认被门拒绝而非静默通过'],
    counter: '自检只 import 不调 apply() —— 只证「文件能加载」，不证「能挂载」',
  },
  P2_bundled_plugin: {
    id: 'P2', name: '常驻插件包（R006 十项骨架）', kind: 'files',
    use: '需要常驻、跨会话、随 profile 启动的宿主能力。',
    artifacts: ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/selfcheck.js', 'lib/gate.js', 'lib/core.js', 'cli.js', 'docs/README.md', 'CHANGELOG.md'],
    gate: '命名门（N1–N4）+ 路径白名单 + dryRun/confirm 入口门 + 目标非空拒写',
    verify: ['node cli.js --selfcheck', 'node cli.js --lean4-check', 'node cli.js --tool-version', 'node cli.js --dry-run'],
    counter: 'apply 阶段 import 未声明符号 → 启动即崩（R006 事故表第 2 行）',
  },
  P3_cli_tool: {
    id: 'P3', name: '独立 CLI 工具（无宿主依赖）', kind: 'files',
    use: '不需要常驻挂载、只要求可脚本化的命令行工具。',
    artifacts: ['package.json', 'cli.js', 'lib/core.js', 'lib/gate.js', 'lib/selfcheck.js', 'docs/README.md', 'CHANGELOG.md'],
    gate: '命名门 + 路径白名单 + dryRun/confirm 入口门',
    verify: ['node cli.js --selfcheck', 'node cli.js --lean4-check', '未知旗标必须 exit 2', '--dry-run 前后外部状态一致'],
    counter: '本模式无 ①：R006 豁免表允许不进库的临时脚本免 ⑤⑥⑧，但 CLI 工具仍须 ②⑥⑦⑨⑩',
  },
  P4_host_client: {
    id: 'P4', name: '宿主 + 客户端 UI（两段式）', kind: 'inline',
    use: '需要可视化交互：面板、卡片、设置项。',
    artifacts: ['code.host 片段', 'code.client 片段（Slot 注册）'],
    gate: '同一 Package 内含 client 时需用户授权（单勾=仅本 Package，双勾=该插件后续版本）',
    verify: ['先 cordis_inspect_query(client, Slots, listSubTree) 取真实 Slot 契约', '注册后确认目标 Slot 未被整体替换'],
    counter: '默认占 root/sidebar 会连带移除其子 Slot —— 应选最窄入口',
  },
  P5_review_remediate: {
    id: 'P5', name: '审查—整改闭环', kind: 'plan',
    use: '存量插件补课：只补缺项、不重写（R006 §8 执行原则）。',
    artifacts: ['整改清单（按 R1–R10 逐项）'],
    gate: '归属优先：属主未同意不代改；补课不夹带其它改动',
    verify: ['整改后重跑 plugin_review，逐项对比', '登记到 §8 表格'],
    counter: '越过属主编辑其它会话的插件目录',
  },
})

export const GATE_ITEMS = deepFreeze([
  { id: 'A', claim: '源码无危险原语', how: '去注释/字符串/正则后扫描禁用原语，避免扫到自己' },
  { id: 'B', claim: '负例全部被拒', how: '造越界输入逐条实测被门拒绝' },
  { id: 'C', claim: '正例可用', how: '合法输入必须能通过，防「门太宽把功能也拦了」' },
  { id: 'D', claim: '--dry-run 零变更', how: '运行前后外部状态实测一致' },
  { id: 'E', claim: '白名单冻结', how: 'Object.isFrozen 为真' },
  { id: 'F', claim: '外部命令白名单', how: '枚举调用点，命令集 ⊆ 允许集（注意别「空集通过」）' },
])

export const COMMAND_WHITELIST = deepFreeze(['node'])
export const NODE_CANDIDATES = deepFreeze(['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', '/opt/local/bin/node'])

// 审查别的插件时用的可疑原语表（命中只报「需人工确认」，不直接判 fail）
export const DANGER_PRIMITIVES = deepFreeze([
  { name: 'rm -rf', re: /\brm\s+-rf\b/ },
  { name: 'pkill/killall', re: /\b(pkill|killall)\b/ },
  { name: 'child_process', re: /\bchild_process\b|\b(execSync|execFileSync|spawnSync)\b/ },
  { name: 'exec/spawn/fork', re: /\b(exec|spawn|fork)\s*\(/ },
  { name: 'process.exit', re: /\bprocess\.exit\s*\(/ },
  { name: 'eval/new Function', re: /\beval\s*\(|new\s+Function\s*\(/ },
  { name: 'process.kill', re: /\bprocess\.kill\s*\(/ },
  { name: 'rmSync/unlinkSync', re: /\b(rmSync|unlinkSync|rmdirSync)\s*\(/ },
])

// R006 ①-5 真挂载冒烟探针（桩 ctx，用于审查别的插件）。脚本内只用双引号，无任何外部输入插值。
export const SMOKE_SCRIPT = 'const url = process.argv[1];'
  + 'const out = { state: "pass", registered: [], effects: 0, errors: [] };'
  + 'const anyStub = (label) => new Proxy(function () {}, {'
  + '  get: (_t, k) => {'
  + '    if (typeof k === "symbol" || k === "then" || k === "toJSON" || k === "inspect") return undefined;'
  + '    if (k === "register") return (d) => { out.registered.push(typeof d === "string" ? d : (d && d.name) || "?"); return () => {}; };'
  + '    if (k === "schemas" || k === "list" || k === "listService") return () => [];'
  + '    return anyStub(label + "." + String(k));'
  + '  },'
  + '  apply: () => anyStub(label + "()"),'
  + '  set: () => true,'
  + '});'
  + 'const ctxBase = {'
  + '  on: () => () => {},'
  + '  effect: (cb) => { out.effects += 1; try { const d = cb(); return typeof d === "function" ? d : () => {}; } catch (e) { out.errors.push(String((e && e.message) || e)); return () => {}; } },'
  + '  get: (n) => anyStub("get:" + String(n)),'
  + '};'
  + 'const ctx = new Proxy(ctxBase, {'
  + '  get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : anyStub("ctx:" + String(k))),'
  + '  set: (t, k, v) => { t[k] = v; return true; },'
  + '});'
  + 'try {'
  + '  const mod = await import(url);'
  + '  const apply = mod && typeof mod.apply === "function" ? mod.apply : (mod && mod.default && typeof mod.default.apply === "function" ? mod.default.apply : null);'
  + '  if (apply === null) { out.state = "fail"; out.errors.push("entry exports no apply(ctx, config)"); }'
  + '  else { await apply(ctx, {}); }'
  + '} catch (e) {'
  + '  const msg = String((e && e.message) || e);'
  + '  const code = e && e.code ? String(e.code) : "";'
  + '  if (code === "ERR_MODULE_NOT_FOUND" || /Cannot find (package|module)/.test(msg)) { out.state = "skipped"; out.reason = msg; }'
  + '  else { out.state = "fail"; out.errors.push(msg); }'
  + '}'
  + 'process.stdout.write("SMOKE:" + JSON.stringify(out) + "\\n");'
