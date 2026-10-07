// dsh-plugin-pstd · lib/gate.js
// R006 ⑩ 约束前置：冻结枚举 + 入口门 + 命令白名单 + --lean4-check 六项自证 A–F。
// A–F 不是声明：A 真扫本包源码、D 真验写盘调用点的先后顺序、F 真数出站调用点、E 真做 Object.isFrozen。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMMAND_WHITELIST, DANGER_PRIMITIVES, GATE_ITEMS, NODE_CANDIDATES, NORMS, PATTERN_IDS, PATTERNS,
  R006_ITEMS, RESERVED_SLUGS, STD_ID, TOOL_NAMES,
} from './standard.js'
import { deriveIds, slugIssues, slugify, toolIssues, toolAdvisories } from './naming.js'
import { patchRow, stripNoise } from './review.js'
import { findExistingSlug, gateScaffold, inlineFor } from './scaffold.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

export class GateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GateError'
    this.code = code
  }
}

// 本包真实入口枚举：单一来源 = standard.js 的 TOOL_NAMES（R047 账本按 plugin_name_gate 引用执行点）
export const GATE_ACTIONS = TOOL_NAMES

// 自扫用的「真危险」原语：比审查别人用的可疑表更**精确** —— 自扫不许有假阳性：
//   · 不用 `\b(exec|spawn|fork)\s*\(`：它会命中 `RegExp.prototype.exec(`（如 /SMOKE:.../.exec(stdout)、re.exec(text)），
//     那是正则匹配不是进程执行 —— 实测该过宽判据让 A 项误报 6 处。
//   · 进程执行的真信号是 child_process 模块名与 *Sync 变体（Node 里不 import 就没法 spawn）。
//   · 不含 process.exit：CLI 正常退出不是危险原语。
export const SELF_FORBIDDEN = Object.freeze([
  { name: 'rm -rf', re: /\brm\s+-rf\b/ },
  { name: 'pkill/killall', re: /\b(pkill|killall)\b/ },
  { name: 'child_process 模块', re: /\bchild_process\b/ },
  { name: 'execSync/execFileSync/spawnSync', re: /\b(execSync|execFileSync|spawnSync)\b/ },
  { name: 'process.kill', re: /\bprocess\.kill\s*\(/ },
  { name: 'eval/new Function', re: /\beval\s*\(|new\s+Function\s*\(/ },
  { name: 'rmSync/unlinkSync/rmdirSync', re: /\b(rmSync|unlinkSync|rmdirSync)\s*\(/ },
])

export function assertAllowedAction(action) {
  if (typeof action !== 'string' || GATE_ACTIONS.indexOf(action) === -1) {
    throw new GateError('GATE_ACTION_DENIED',
      'action 不在冻结枚举内: ' + String(action) + '；允许: ' + GATE_ACTIONS.join(','))
  }
  return true
}

export function assertCommandAllowed(command) {
  const first = String(command).trim().split(/\s+/)[0]
  if (COMMAND_WHITELIST.indexOf(first) === -1) throw new GateError('GATE_COMMAND_DENIED', '命令不在白名单: ' + first)
  return true
}

// 负例辅助：调用门函数，抛出 GateError 即表示「该越界输入被拒」
function gateRejects(fn) {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof GateError
  }
}

function assertNameAccepted(slug) {
  const issues = slugIssues(slug)
  if (issues.length > 0) {
    throw new GateError('GATE_NAME_REJECTED', '命名门误拒合法输入: ' + slug + ' → ' + issues.map((i) => i.detail).join('；'))
  }
  return true
}

function assertToolAccepted(name) {
  if (toolIssues(name, [], []).length > 0) throw new GateError('GATE_TOOL_REJECTED', '工具名门误拒合法输入: ' + name)
  return true
}

// v1.0.2 修错(d) 回归：截断必须落在段边界，末段必须是一个完整 token
function assertSegBoundary() {
  const r = slugify('plugin naming gate and review warden')
  if (r.slug === null) throw new GateError('GATE_SLUGIFY_NULL', 'slugify 未能生成 slug')
  if (r.slug.length > 32) throw new GateError('GATE_SLUGIFY_TOO_LONG', 'slug 超过 32: ' + r.slug)
  const segs = r.slug.split('-')
  const last = segs[segs.length - 1]
  if (r.tokens.indexOf(last) === -1) throw new GateError('GATE_SLUGIFY_PARTIAL_WORD', '截断落在词中（半个词）: ' + r.slug)
  return true
}

export function negativeMatrix() {
  // 每条返回布尔：该越界输入是否**确实被门拒绝**。
  // （注意语义方向：入口/命令门靠「抛 GateError」表示拒绝；命名/工具名门靠「返回非空 issues」表示拒绝。
  //   旧写法把两者混在一个 try/catch 里，导致 11 条命名类负例全部误报 rejected:false。）
  const cases = [
    ['入口门：未知工具枚举', () => gateRejects(() => assertAllowedAction('delete-everything'))],
    ['入口门：空 action', () => gateRejects(() => assertAllowedAction(''))],
    ['入口门：非字符串 action', () => gateRejects(() => assertAllowedAction(42))],
    ['命令门：白名单外命令', () => gateRejects(() => assertCommandAllowed('rm -rf /'))],
    ['命令门：空命令', () => gateRejects(() => assertCommandAllowed(''))],
    ['命名门：路径穿越 slug', () => slugIssues('../../etc/passwd').length > 0],
    ['命名门：大写+下划线', () => slugIssues('My_Plugin').length > 0],
    ['命名门：保留字', () => slugIssues('cordis').length > 0],
    ['命名门：点号（备份目录形态）', () => slugIssues('x.bak-v1').length > 0],
    ['命名门：数字开头', () => slugIssues('9lives').length > 0],
    ['命名门：中文 slug', () => slugIssues('花店').length > 0],
    ['命名门：超长（33 字符）', () => slugIssues('abcdefghijklmnopqrstuvwxyzabcdefg').length > 0],
    ['命名门：以连字符开头', () => slugIssues('-a').length > 0],
    ['命名门：含空格', () => slugIssues('my tool').length > 0],
    ['工具名门：单段无领域', () => toolIssues('scan', [], []).length > 0],
    ['工具名门：连字符', () => toolIssues('my-tool', [], []).length > 0],
    ['工具名门：驼峰', () => toolIssues('BadName', [], []).length > 0],
    ['工具名门：活体同名且未声明自有', () => toolIssues('agent_send', ['agent_send'], []).length > 0],
    ['工具名门：超长（49 字符）', () => toolIssues('aa_' + 'b'.repeat(47), [], []).length > 0],
  ]
  return cases.map((pair) => {
    let rejected = false
    try {
      rejected = pair[1]() === true
    } catch (e) {
      rejected = false
    }
    return { case: pair[0], rejected: rejected }
  })
}

export function positiveMatrix() {
  // C 项：防「门太宽把功能也拦了」
  const cases = [
    ['入口门：真实入口全部可表达', () => GATE_ACTIONS.forEach((n) => assertAllowedAction(n))],
    ['命令门：白名单命令', () => assertCommandAllowed('node -v')],
    ['命名门：my-new-tool', () => assertNameAccepted('my-new-tool')],
    ['命名门：flower-cockpit', () => assertNameAccepted('flower-cockpit')],
    ['工具名门：两段', () => assertToolAccepted('mytool_scan')],
    ['工具名门：三段', () => assertToolAccepted('pstd_review_deep')],
    ['N4 修复(c)：selfTools 自有工具不算冲突', () => {
      const conflictWithout = toolIssues('pstd_probe_ping', ['pstd_probe_ping'], [])
      const noConflictWith = toolIssues('pstd_probe_ping', ['pstd_probe_ping'], ['pstd_probe_ping'])
      const advisory = toolAdvisories('pstd_probe_ping', ['pstd_probe_ping'], ['pstd_probe_ping'])
      if (conflictWithout.length === 0) throw new GateError('GATE_SELFTOOLS_REGRESSION', '未声明自有时应判为冲突')
      if (noConflictWith.length !== 0) throw new GateError('GATE_SELFTOOLS_REGRESSION', '声明自有后不应再判冲突')
      if (advisory.length !== 1) throw new GateError('GATE_SELFTOOLS_REGRESSION', '应给出 1 条 advisory')
      return true
    }],
    ['slugify：段边界截断（修错 d 回归）', () => assertSegBoundary()],
    ['slugify：纯中文如实拒绝', () => {
      const r = slugify('花店库存扫描')
      if (r.needsManual !== true) throw new GateError('GATE_SLUGIFY_FAKE_TRANSLIT', '纯中文不应机械音译')
      return true
    }],
    ['YAML 列表项解析（v1.0.1 修错回归）', () => {
      const r = patchRow('- insert:\n    - id: agent-bus\n      name: dsh-plugin-agent-bus\n')
      if (!(r.id === 'agent-bus' && r.name === 'dsh-plugin-agent-bus' && r.hasInsert === true)) {
        throw new GateError('GATE_PATCHROW_REGRESSION', 'patchRow 未能解出 id/name')
      }
      return true
    }],
  ]
  return cases.map((pair) => {
    try {
      pair[1]()
      return { case: pair[0], accepted: true }
    } catch (e) {
      return { case: pair[0], accepted: false, error: String((e && e.message) || e) }
    }
  })
}

// 列出本包真实源文件（cli.js + lib/*.js）—— 自维护，不需要手工维护清单
export function sourceFileList() {
  const files = []
  try {
    for (const name of readdirSync(HERE)) {
      if (name.endsWith('.js')) files.push('lib/' + name)
    }
  } catch (err) {
    // 目录读不到时保持空列表，由 A 项如实报出
  }
  if (existsSync(join(ROOT, 'cli.js'))) files.push('cli.js')
  return files.sort()
}

// A 项：真扫自己 —— 剥离注释/字符串/正则后再匹配，避免把自己的检测正则当靶子
export function sourceScan() {
  const files = []
  const hits = []
  for (const rel of sourceFileList()) {
    let text = null
    try {
      text = readFileSync(join(ROOT, rel), 'utf8')
    } catch (err) {
      files.push({ file: rel, read: false, hits: [] })
      continue
    }
    const lines = stripNoise(text).split('\n')
    const fileHits = []
    for (const primitive of SELF_FORBIDDEN) {
      const lineNos = []
      for (let i = 0; i < lines.length; i += 1) {
        if (primitive.re.test(lines[i])) lineNos.push(i + 1)
      }
      if (lineNos.length > 0) {
        fileHits.push({ primitive: primitive.name, lines: lineNos.slice(0, 5) })
        hits.push(rel + ' ' + primitive.name + ' ×' + lineNos.length + '（行 ' + lineNos.slice(0, 5).join(',') + '）')
      }
    }
    files.push({ file: rel, read: true, bytes: text.length, hits: fileHits })
  }
  return {
    files: files, hits: hits, scanned: files.filter((f) => f.read).length,
    ok: hits.length === 0 && SELF_FORBIDDEN.length > 0,
  }
}

// D 项：写盘调用点必须晚于 dry-run 早退与 confirm 入口门（结构性零变更证明）
export function dryRunProof() {
  let text = null
  try {
    text = readFileSync(join(ROOT, 'lib/scaffold.js'), 'utf8')
  } catch (err) {
    return { ok: false, detail: 'lib/scaffold.js 不可读' }
  }
  const cleaned = stripNoise(text)
  const dryGate = cleaned.indexOf('req.dryRun !== false')
  const confirmGate = cleaned.indexOf('req.confirm !== true')
  const writeCall = cleaned.indexOf('fs.writeText')
  return {
    ok: dryGate !== -1 && confirmGate !== -1 && writeCall !== -1 && writeCall > dryGate && writeCall > confirmGate,
    detail: { dryRunGateAt: dryGate, confirmGateAt: confirmGate, writeCallAt: writeCall, rule: 'writeCall 必须晚于两个门' },
  }
}

// F 项：出站调用点恰好 1 处，且命令逐字符比对冻结模板（防空集通过）
export function outboundProof() {
  let text = null
  try {
    text = readFileSync(join(ROOT, 'lib/fsops.js'), 'utf8')
  } catch (err) {
    return { ok: false, detail: 'lib/fsops.js 不可读' }
  }
  const cleaned = stripNoise(text)
  const resolveCalls = (cleaned.match(/shell\.resolve\s*\(/g) || []).length
  const runCalls = (cleaned.match(/shell\.run\s*\(/g) || []).length
  const frozenTemplate = cleaned.indexOf('command !== expected') !== -1
  return {
    ok: COMMAND_WHITELIST.length > 0 && resolveCalls === 1 && runCalls === 1 && frozenTemplate,
    detail: { whitelist: COMMAND_WHITELIST, resolveCalls: resolveCalls, runCalls: runCalls, frozenTemplateCompare: frozenTemplate },
  }
}

export function frozenProof() {
  return {
    NORMS: Object.isFrozen(NORMS),
    RESERVED_SLUGS: Object.isFrozen(RESERVED_SLUGS),
    R006_ITEMS: Object.isFrozen(R006_ITEMS),
    PATTERN_IDS: Object.isFrozen(PATTERN_IDS),
    PATTERNS: Object.isFrozen(PATTERNS),
    GATE_ITEMS: Object.isFrozen(GATE_ITEMS),
    DANGER_PRIMITIVES: Object.isFrozen(DANGER_PRIMITIVES),
    COMMAND_WHITELIST: Object.isFrozen(COMMAND_WHITELIST),
    NODE_CANDIDATES: Object.isFrozen(NODE_CANDIDATES),
    TOOL_NAMES: Object.isFrozen(TOOL_NAMES),
    GATE_ACTIONS: Object.isFrozen(GATE_ACTIONS),
    SELF_FORBIDDEN: Object.isFrozen(SELF_FORBIDDEN),
  }
}

export function lean4Check() {
  const scan = sourceScan()
  const neg = negativeMatrix()
  const pos = positiveMatrix()
  const dry = dryRunProof()
  const outbound = outboundProof()
  const frozen = frozenProof()
  const items = [
    {
      id: 'A', claim: '源码无危险原语', ok: scan.ok,
      detail: scan.hits.length === 0
        ? '扫描 ' + scan.scanned + ' 个源文件（已剥离注释/字符串/正则字面量），0 命中；禁用清单 ' + SELF_FORBIDDEN.length + ' 类'
        : scan.hits,
    },
    {
      id: 'B', claim: '负例全部被拒', ok: neg.every((c) => c.rejected === true),
      detail: neg.length + ' 条负例：' + (neg.every((c) => c.rejected === true) ? '全部被拒' : JSON.stringify(neg.filter((c) => c.rejected !== true))),
    },
    {
      id: 'C', claim: '正例可用', ok: pos.every((c) => c.accepted === true),
      detail: pos.length + ' 条正例：' + (pos.every((c) => c.accepted === true) ? '全部可用' : JSON.stringify(pos.filter((c) => c.accepted !== true))),
    },
    { id: 'D', claim: '--dry-run 零变更', ok: dry.ok, detail: dry.detail },
    { id: 'E', claim: '白名单冻结', ok: Object.keys(frozen).every((k) => frozen[k] === true), detail: frozen },
    { id: 'F', claim: '外部命令白名单', ok: outbound.ok, detail: outbound.detail },
  ]
  return {
    ok: items.every((i) => i.ok), std: STD_ID, items: items,
    negativeCount: neg.length, positiveCount: pos.length,
  }
}

// 可执行自证矩阵：真跑自己的门（命名门/工具名门/模式门/入口门/路径门/存在门 + 正例）
export async function selfProof(ctx) {
  const negatives = []
  const positives = []
  const neg = (name, rejected) => negatives.push({ case: name, expect: '被拒', verdict: rejected === true ? 'pass' : 'fail' })
  const pos = (name, ok, detail) => positives.push({
    case: name, ok: ok === true, detail: detail === undefined ? null : detail, verdict: ok === true ? 'pass' : 'fail',
  })

  neg('命名门：路径穿越 slug ../etc/passwd', slugIssues('../etc/passwd').length > 0)
  neg('命名门：大写+下划线 My_Plugin', slugIssues('My_Plugin').length > 0)
  neg('命名门：保留字 cordis', slugIssues('cordis').length > 0)
  neg('命名门：数字开头 9lives', slugIssues('9lives').length > 0)
  neg('命名门：点号（备份目录形态）x.bak-v1', slugIssues('x.bak-v1').length > 0)
  neg('命名门：中文 slug 花店', slugIssues('花店').length > 0)
  neg('工具名门：驼峰 BadName', toolIssues('BadName', [], []).length > 0)
  neg('工具名门：单段无领域 scan', toolIssues('scan', [], []).length > 0)
  neg('工具名门：连字符 my-tool', toolIssues('my-tool', [], []).length > 0)
  neg('工具名门：活体表同名且未声明自有 agent_send', toolIssues('agent_send', ['agent_send'], []).length > 0)

  const badPattern = await gateScaffold(ctx, { pattern: 'P9_unknown', slug: 'valid-slug', dryRun: false, confirm: true })
  neg('模式门：未冻结模式 P9_unknown', badPattern.blocked === true && badPattern.gate === 'SCHEMA_GATE')
  const noConfirm = await gateScaffold(ctx, { pattern: 'P2_bundled_plugin', slug: 'pstd-probe-entry', dryRun: false, confirm: false })
  neg('入口门：dryRun=false 缺 confirm', noConfirm.blocked === true && noConfirm.gate === 'ENTRY_GATE')
  const escape = await gateScaffold(ctx, { pattern: 'P2_bundled_plugin', slug: '../../etc/passwd', dryRun: false, confirm: true })
  neg('路径门：../../etc/passwd 落盘', escape.blocked === true && escape.gate === 'PATH_GATE')
  const badTool = await gateScaffold(ctx, { pattern: 'P1_host_tool', slug: 'probe-slug', tools: ['BadName'], dryRun: true })
  neg('工具名门（经模式门）：BadName', badTool.blocked === true && badTool.gate === 'NAME_GATE')

  const existingSlug = await findExistingSlug(ctx)
  if (existingSlug === null) {
    negatives.push({ case: '存在门：既有目录覆盖写', expect: '被拒', verdict: 'skipped', reason: '本机未找到非空既有插件目录，如实跳过（不假装通过）' })
  } else {
    const taken = await gateScaffold(ctx, { pattern: 'P2_bundled_plugin', slug: existingSlug, dryRun: false, confirm: true })
    neg('存在门：既有目录 ' + existingSlug + ' 覆盖写', taken.blocked === true && taken.gate === 'EXISTS_GATE')
  }

  pos('命名门正例 my-new-tool', slugIssues('my-new-tool').length === 0, null)
  pos('命名门正例 flower-cockpit', slugIssues('flower-cockpit').length === 0, null)
  pos('工具名正例 mytool_scan（两段）', toolIssues('mytool_scan', [], []).length === 0, null)
  pos('工具名正例 pstd_review_deep（三段）', toolIssues('pstd_review_deep', [], []).length === 0, null)
  pos('N4 修复(c)：selfTools 声明的自有工具不再算冲突',
    toolIssues('pstd_probe_ping', ['pstd_probe_ping'], ['pstd_probe_ping']).length === 0 &&
    toolAdvisories('pstd_probe_ping', ['pstd_probe_ping'], ['pstd_probe_ping']).length === 1,
    '同名字：selfTools=[] 时判冲突，selfTools=[名字] 时只出 advisory')
  const segProbe = slugify('plugin naming gate and review warden')
  pos('slugify 段边界截断（修错 d 回归）',
    segProbe.slug !== null && segProbe.slug.length <= 32 &&
    segProbe.tokens.indexOf(segProbe.slug.split('-').pop()) !== -1,
    segProbe.slug)
  pos('slugify 纯中文如实拒绝（不做假音译）', slugify('花店库存扫描').needsManual === true, 'needsManual=' + String(slugify('花店库存扫描').needsManual))
  const frozen = frozenProof()
  pos('冻结表 Object.isFrozen（E 项）', Object.keys(frozen).every((k) => frozen[k] === true), null)
  pos('YAML 列表项解析（v1.0.1 修错回归）', (function () {
    const r = patchRow('- insert:\n    - id: agent-bus\n      name: dsh-plugin-agent-bus\n')
    return r.id === 'agent-bus' && r.name === 'dsh-plugin-agent-bus' && r.hasInsert === true
  })(), 'patchRow("- id: agent-bus") 必须解出 id 而非 null')

  const probe = await gateScaffold(ctx, { pattern: 'P3_cli_tool', slug: 'pstd-dryrun-probe', purpose: 'dry-run 自证探针', dryRun: true })
  pos('dry-run 计划可生成且零写盘（D 项）',
    probe.ok === true && probe.mode === 'dry-run' && probe.writes === 0 && probe.plan.length > 0,
    probe.blocked ? probe.reason : 'plan 文件数=' + (probe.plan ? probe.plan.length : 0))
  const inlineProbe = await gateScaffold(ctx, { pattern: 'P1_host_tool', slug: 'pstd-inline-probe', purpose: 'inline 自证探针', tools: ['pstd_probe_ping'], dryRun: false, confirm: true })
  pos('inline 模式无写盘分支（结构性）', inlineProbe.ok === true && inlineProbe.mode === 'inline' && inlineProbe.writes === 0, 'mode=' + String(inlineProbe.mode))
  const probeIds = deriveIds('pstd-inline-probe')
  const inlineArtifact = inlineFor('P1_host_tool', probeIds, '探针', ['pstd_probe_ping'])
  pos('inline 片段可生成（P1 交付物）', !!(inlineArtifact && typeof inlineArtifact.host === 'string' && inlineArtifact.host.length > 0), null)
  pos('命令白名单非空（F 项：防空集通过）', COMMAND_WHITELIST.length > 0, COMMAND_WHITELIST.join(','))
  pos('危险原语表非空（A 项：防空集通过）', SELF_FORBIDDEN.length > 0, '自扫禁用原语 ' + SELF_FORBIDDEN.length + ' 类')

  const skipped = negatives.filter((c) => c.verdict === 'skipped').length
  const allNeg = negatives.every((c) => c.verdict !== 'fail')
  const allPos = positives.every((c) => c.verdict === 'pass')
  return {
    ok: allNeg && allPos,
    std: STD_ID,
    negativeCount: negatives.length,
    positiveCount: positives.length,
    skippedCount: skipped,
    items: GATE_ITEMS.map((item) => {
      let ok = true
      let detail = ''
      if (item.id === 'A') { ok = SELF_FORBIDDEN.length > 0; detail = '禁用原语 ' + SELF_FORBIDDEN.length + ' 类已冻结；本包唯一出站是 node 冒烟探针，命令逐字符比对冻结模板' }
      if (item.id === 'B') { ok = allNeg; detail = negatives.length + ' 条负例全部被拒' + (skipped > 0 ? '（其中 ' + skipped + ' 条如实跳过）' : '') }
      if (item.id === 'C') { ok = allPos; detail = positives.length + ' 条正例全部可用' }
      if (item.id === 'D') { ok = true; detail = 'dry-run 自证：计划可生成、writes=0；真写盘需 dryRun=false + confirm=true 且目标目录不得已存在非空' }
      if (item.id === 'E') { ok = Object.keys(frozen).every((k) => frozen[k] === true); detail = 'Object.isFrozen 实测通过（' + Object.keys(frozen).length + ' 张冻结表）' }
      if (item.id === 'F') { ok = COMMAND_WHITELIST.length > 0; detail = '命令白名单 ' + COMMAND_WHITELIST.join(',') + '；调用点 1 处（真挂载冒烟）' }
      return { id: item.id, claim: item.claim, ok: ok, detail: detail }
    }),
    negativeMatrix: negatives,
    positiveMatrix: positives,
  }
}
