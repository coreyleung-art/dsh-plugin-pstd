// dsh-plugin-pstd · lib/index.js
// R006 ① dsh 插件形态：export name / inject / apply(ctx, config)；工具注册归属本插件 Fiber。
// 工具名固定为 standard.js 的 TOOL_NAMES —— R047 账本按 plugin_name_gate 引用执行点，改名即破坏账本。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { runSelfCheck } from './selfcheck.js'
import { withLog } from './log.js'
import {
  COMMAND_WHITELIST, DANGER_PRIMITIVES, GATE_ITEMS, NORMS, PATTERNS, PATTERN_IDS, RESERVED_SLUGS,
  R006_ITEMS, STD_ID, TOOL_NAMES,
} from './standard.js'
import { deriveIds, slugIssues, slugify, toSlug, toolAdvisories, toolIssues } from './naming.js'
import { listEntriesOn, liveToolNames, resolveBase, scanRegistry } from './fsops.js'
import { namingReview, reviewOne } from './review.js'
import { gateScaffold } from './scaffold.js'
import { frozenProof, selfProof } from './gate.js'

export const name = 'pstd'
export const inject = ['tools']

function textOut() {
  return { schema: { type: 'json' }, render: (_args, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] }
}

// ★ 必须在 apply 作用域内构造：execute 闭包要捕获 ctx。
//   （v1.0.2 实测教训：定义写在模块作用域时 apply 能注册成功、但一调用就 ReferenceError: ctx is not defined ——
//    挂载冒烟只证明"注册成功"，不证明"可调用"，所以这个坑由宿主路径探针才抓出来。）
export function createDefinitions(ctx) {
  return [
  {
    name: 'plugin_standard',
    description: '插件命名与审查管理员 · 规范台：返回 PSTD ' + STD_ID + ' 标准切片——命名规范 N1–N8、R006 插件化·工具化十项逐项判据与整改动作、五种交付模式 P1–P5（含门型与验收命令）、约束门型与 --lean4-check 六项 A–F。action=selfproof 会真实运行本插件自己的约束门（负例矩阵 + 正例矩阵）并逐条回报；条数由运行时算出，描述里不写死数字。',
    parameters: {
      action: {
        type: 'string', required: true,
        enum: ['norms', 'r006', 'patterns', 'gates', 'all', 'selfproof'],
        description: 'norms=命名规范 / r006=十项判据 / patterns=模式目录 / gates=门型与自证清单 / all=全部 / selfproof=跑自证矩阵',
      },
    },
    output: textOut(),
    async execute(args) {
      return await withLog('plugin_standard', args, async () => {
        const action = String(args.action)
        if (action === 'selfproof') {
          const proof = await selfProof(ctx)
          return {
            ok: proof.ok, std: STD_ID, action: action, selfproof: proof,
            negativeCount: proof.negativeCount, positiveCount: proof.positiveCount,
            skippedCount: proof.skippedCount, frozenProof: frozenProof(),
          }
        }
        // 修复(v1.0.2 a)：按 action 条件装配 payload —— 绝不出现值为 undefined 的字段
        //   （旧版返回 { r006: undefined, ... } 被 harness lossless-JSON 校验拒，四切片动作全废）
        const payload = {
          ok: true,
          std: STD_ID,
          action: action,
          toolChain: ['① 命名门 plugin_name_gate → ② 模式化交付 plugin_pattern_scaffold → ③ 审查 plugin_review → ④ 整改 P5'],
        }
        if (action === 'norms' || action === 'all') {
          payload.norms = NORMS
          payload.reservedSlugs = RESERVED_SLUGS
        }
        if (action === 'r006' || action === 'all') payload.r006 = R006_ITEMS
        if (action === 'patterns' || action === 'all') payload.patterns = PATTERN_IDS.map((id) => PATTERNS[id])
        if (action === 'gates' || action === 'all') {
          payload.gates = {
            items: GATE_ITEMS,
            commandWhitelist: COMMAND_WHITELIST,
            dangerPrimitives: DANGER_PRIMITIVES.map((d) => d.name),
          }
        }
        payload.selfProofHint = 'action=selfproof 真跑负例矩阵与正例矩阵；条数以输出为准'
        return payload
      })
    },
  },
  {
    name: 'plugin_name_gate',
    description: '插件命名门（PSTD N1–N8）：check=校验名称/工具名是否合规并给出规范形；allocate=从用途描述分配一套规范标识（slug/目录/包名/插件行/工具前缀/日志路径/登记卡键/idPrefix）并检查目录与活体工具表占用；audit=扫描本机全部 dsh-plugin-* 目录，按 N1–N4 逐条出违规清单；explain=只返回规范。命名门是模式化交付与审查的前置门：不通过不进入下一步。',
    parameters: {
      action: { type: 'string', required: true, enum: ['check', 'allocate', 'audit', 'explain'], description: 'check / allocate / audit / explain' },
      name: { type: 'string', description: 'check 用：待校验名称（dsh-plugin-x、x、或含路径）' },
      purpose: { type: 'string', description: 'allocate 用：用途描述（英文/混排可机械生成 slug；纯中文会如实要求手工指定）' },
      tools: { type: 'array', items: { type: 'string' }, description: '拟注册的工具名（按 N4 校验：snake_case、≥2 段、活体表唯一）' },
      selfTools: { type: 'array', items: { type: 'string' }, description: '已声明为本插件自有的工具名：命中活体表时只出 advisory，不计入冲突、不导致 ok=false（v1.0.2 修误报）' },
      base: { type: 'string', description: '插件根目录（省略=自动探测 workspaceRoot / ~）' },
    },
    output: textOut(),
    async execute(args) {
      return await withLog('plugin_name_gate', args, async () => {
        const action = String(args.action)
        if (action === 'explain') return { ok: true, action: action, std: STD_ID, norms: NORMS, reservedSlugs: RESERVED_SLUGS }
        const fs = ctx.get('fs')
        if (fs === undefined || fs === null) return { ok: false, action: action, error: 'fs 服务不可用（环境问题，非包问题）' }
        const info = await resolveBase(ctx, args.base)
        const live = liveToolNames(ctx)
        const selfTools = Array.isArray(args.selfTools) ? args.selfTools.map((t) => String(t)) : []

        if (action === 'check') {
          const slug = toSlug(args.name)
          const issues = slugIssues(slug)
          const toolReport = []
          const toolList = Array.isArray(args.tools) ? args.tools : []
          for (const raw of toolList) {
            const toolName = String(raw)
            const ti = toolIssues(toolName, live, selfTools)
            toolReport.push({
              tool: toolName, verdict: ti.length === 0 ? 'pass' : 'fail',
              issues: ti, advisory: toolAdvisories(toolName, live, selfTools),
            })
          }
          let dirTaken = null
          if (info.base !== null) {
            const names = await listEntriesOn(fs, info.base)
            dirTaken = names === null ? null : names.some((e) => e.name === 'dsh-plugin-' + slug)
          }
          // advisory 不参与 ok 判定（v1.0.2 修复(c)：自有工具不算冲突）
          const ok = issues.length === 0 && toolReport.every((t) => t.verdict === 'pass') && dirTaken !== true
          return {
            ok: ok, action: action, std: STD_ID, input: String(args.name == null ? '' : args.name), slug: slug,
            verdict: ok ? 'pass' : 'fail', canonical: deriveIds(slug),
            namingIssues: issues, toolReport: toolReport, dirAlreadyExists: dirTaken, base: info.base,
            liveToolCount: live.length, selfToolsDeclared: selfTools,
            fix: ok ? null : '按 canonical 字段改名；工具名用 <领域>_<动作>[_<对象>]；目录已占用则换 slug',
          }
        }

        if (action === 'allocate') {
          const gen = slugify(args.purpose)
          if (gen.slug === null) {
            return {
              ok: false, action: action, std: STD_ID, needsManualSlug: true, reason: gen.reason,
              guidance: gen.guidance, examples: ['flower-inventory', 'voice-activate', 'stock-alert'],
              norms: NORMS.map((n) => n.id + ' ' + n.title),
            }
          }
          const names = info.base === null ? [] : (await listEntriesOn(fs, info.base)) || []
          const taken = names.some((e) => e.name === 'dsh-plugin-' + gen.slug)
          const candidates = [gen.slug, gen.slug + '-tool', gen.slug + '-core'].filter((s) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(s))
          let chosen = gen.slug
          if (taken) {
            const free = candidates.find((s) => !names.some((e) => e.name === 'dsh-plugin-' + s))
            chosen = free || gen.slug
          }
          const def = deriveIds(chosen)
          const toolReport = []
          const toolList = Array.isArray(args.tools) ? args.tools : []
          for (const raw of toolList) {
            const toolName = String(raw)
            const ti = toolIssues(toolName, live, selfTools)
            toolReport.push({
              tool: toolName, verdict: ti.length === 0 ? 'pass' : 'fail',
              issues: ti, advisory: toolAdvisories(toolName, live, selfTools),
            })
          }
          return {
            ok: !taken, action: action, std: STD_ID, purpose: String(args.purpose == null ? '' : args.purpose),
            mechanical: { extractedTokens: gen.tokens, hasCJK: gen.hasCJK, truncated: gen.truncated === true, droppedTokens: gen.droppedTokens || [] },
            canonical: def, slugTaken: taken, suggestions: candidates, chosen: chosen,
            base: info.base, toolReport: toolReport, liveToolCount: live.length, selfToolsDeclared: selfTools,
            next: [
              'plugin_name_gate action=check 复核',
              'plugin_pattern_scaffold（dryRun 默认 true）',
              'plugin_review(target="' + def.packageName + '", deep=true)',
            ],
          }
        }

        if (info.base === null) return { ok: false, action: 'audit', error: info.error, tried: info.tried }
        const roots = await scanRegistry(ctx, info.base)
        const entries = []
        const byRule = {}
        for (const root of roots) {
          for (const entry of root.entries) {
            const review = await namingReview(ctx, entry.path, entry.dirName)
            review.where = entry.where
            entries.push(review)
            for (const rule of review.rules) {
              if (rule.verdict === 'fail') {
                if (!byRule[rule.rule]) byRule[rule.rule] = []
                byRule[rule.rule].push(entry.dirName)
              }
            }
          }
        }
        const failing = entries.filter((e) => e.verdict === 'fail')
        return {
          ok: failing.length === 0, action: 'audit', std: STD_ID, base: info.base,
          scanned: entries.length, pass: entries.length - failing.length, fail: failing.length,
          roots: roots.map((r) => ({ where: r.where, path: r.path, available: r.available, pluginDirs: r.entries.length })),
          violationsByRule: byRule,
          entries: entries.map((e) => ({ where: e.where, dir: e.dirName, slug: e.slug, verdict: e.verdict, rules: e.rules })),
          note: 'N4 审计只判形式；活体表唯一性只对「新名字」（check/allocate）有意义——已挂载插件自己的工具本就在活体表里',
        }
      })
    },
  },
  {
    name: 'plugin_review',
    description: '插件审查员（R006 十项）：对一个插件目录逐项出判据与证据——①形态（含 ★真挂载冒烟的 pass/fail/skipped/timeout 四态如实分报）②TCC 自检 ③CLD 自适应 ④dsh 版本自适应 ⑤文档化 ⑥版本单一来源 ⑦统一日志 ⑧自动落链（无网络→如实标记未验证，不假装通过）⑨CLI 治理 ⑩约束门（冻结白名单 + 危险原语扫描，扫描前剥离注释/字符串以免误伤自己的检测正则）。deep=true 会在插件目录内真的跑 node 挂载冒烟。all=true 按目录批量审查。',
    parameters: {
      target: { type: 'string', description: '插件目录名（dsh-plugin-x / x）或绝对路径' },
      all: { type: 'boolean', description: '扫描全部 dsh-plugin-* 目录' },
      deep: { type: 'boolean', description: '执行真挂载冒烟（需 shell；缺 node 或沙箱拒绝会如实 skipped，不算失败）' },
      limit: { type: 'integer', description: 'all 模式下最多审查数量（默认 12）' },
    },
    output: textOut(),
    async execute(args) {
      return await withLog('plugin_review', args, async () => {
        const fs = ctx.get('fs')
        if (fs === undefined || fs === null) return { ok: false, error: 'fs 服务不可用（环境问题，非包问题）' }
        const deep = args.deep === true
        const info = await resolveBase(ctx, null)
        if (args.all === true) {
          if (info.base === null) return { ok: false, error: info.error, tried: info.tried }
          const roots = await scanRegistry(ctx, info.base)
          const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 12
          const targets = []
          for (const root of roots) for (const entry of root.entries) targets.push(entry)
          const selected = targets.slice(0, limit)
          const reports = []
          for (const entry of selected) reports.push(await reviewOne(ctx, entry.path, { deep: deep }))
          const tally = { pass10: 0, failed: 0, byItem: {} }
          for (const report of reports) {
            if (report.score === '10/10') tally.pass10 += 1
            if (report.items.some((i) => i.verdict === 'fail')) tally.failed += 1
            for (const item of report.items) {
              if (!tally.byItem[item.id]) tally.byItem[item.id] = { pass: 0, partial: 0, fail: 0, skipped: 0 }
              tally.byItem[item.id][item.verdict] = (tally.byItem[item.id][item.verdict] || 0) + 1
            }
          }
          return {
            ok: true, mode: 'fleet-review', std: STD_ID, base: info.base, deep: deep,
            summary: { total: targets.length, reviewed: reports.length, notReviewed: Math.max(0, targets.length - reports.length) },
            tally: tally,
            reports: reports.map((r) => ({
              dir: r.dirName, score: r.score, verdict: r.verdict,
              failures: r.items.filter((i) => i.verdict === 'fail').map((i) => i.id + ' ' + i.name),
              notProven: r.items.filter((i) => i.verdict === 'partial' || i.verdict === 'skipped').map((i) => i.id),
            })),
          }
        }
        const raw = String(args.target == null ? '' : args.target)
        if (raw.length === 0) return { ok: false, error: '缺少 target（或用 all=true）' }
        const candidates = []
        if (raw.indexOf('/') === 0) candidates.push(raw)
        else {
          const slug = toSlug(raw)
          if (info.base !== null) {
            candidates.push(info.base + '/dsh-plugin-' + slug)
            candidates.push(info.base + '/dsh-collab/devices/dsh-plugin-' + slug)
          }
          candidates.push(raw)
        }
        let found = null
        for (const cand of candidates) {
          const list = await listEntriesOn(fs, cand)
          if (list !== null) { found = cand; break }
        }
        if (found === null) {
          return { ok: false, error: '未找到插件目录', tried: candidates, hint: '用 plugin_name_gate action=audit 列出本机全部 dsh-plugin-* 目录' }
        }
        const report = await reviewOne(ctx, found, { deep: deep })
        return Object.assign({ ok: true, mode: deep ? 'single-deep' : 'single', std: STD_ID }, report)
      })
    },
  },
  {
    name: 'plugin_pattern_list',
    description: '模式化交付目录（P1–P5）：每种模式的适用场景、产物清单、门型、验收命令与反例。P1=会话内宿主工具 / P2=常驻插件包（R006 十项骨架，可落盘）/ P3=独立 CLI 工具（可落盘）/ P4=宿主+客户端 UI / P5=审查—整改闭环。选模式是交付第一步，命名门是第二步。',
    parameters: {
      detail: { type: 'boolean', description: 'true=附带字段级说明（默认 false 精简）' },
    },
    output: textOut(),
    async execute(args) {
      return await withLog('plugin_pattern_list', args, async () => ({
        ok: true, std: STD_ID,
        patterns: PATTERN_IDS.map((id) => PATTERNS[id]),
        detail: args.detail === true,
        chooseHint: '要落盘 → P2/P3；只在进程内生效 → P1；要 UI → P4；给存量补课 → P5',
      }))
    },
  },
  {
    name: 'plugin_pattern_scaffold',
    description: '模式化交付生成器：按冻结模式（P1–P5）用规范命名生成交付物。默认 dryRun=true 零变更（只出计划/片段）；dryRun=false 需同时 confirm=true（入口门），且目标目录已存在非空一律拒写（本工具无覆盖能力）。P1/P4/P5 只有返回片段/计划的分支，代码里根本不存在写盘调用。生成前先过命名门（N1–N4），不通过即拒。',
    parameters: {
      pattern: { type: 'string', required: true, enum: PATTERN_IDS, description: '模式（冻结枚举）' },
      slug: { type: 'string', description: '目标 slug（不带 dsh-plugin- 前缀）' },
      purpose: { type: 'string', description: '一句话用途（写入 description/docs）' },
      tools: { type: 'array', items: { type: 'string' }, description: 'P1/P2/P4 生成的工具名（按 N4 校验）' },
      outRoot: { type: 'string', enum: ['home', 'devices'], description: '落盘根：home=~/ | devices=~/dsh-collab/devices/（P2/P3 用）' },
      dryRun: { type: 'boolean', description: '默认 true：只出计划不落盘' },
      confirm: { type: 'boolean', description: 'dryRun=false 时必须为 true（二次确认）' },
      base: { type: 'string', description: '插件根目录（省略=自动探测）' },
    },
    output: textOut(),
    async execute(args) {
      return await withLog('plugin_pattern_scaffold', args, async () => await gateScaffold(ctx, args))
    },
  },
  ]
}

export function apply(ctx, config = {}) {
  // R006 ② 自查门：apply 最开始调用（缺 peer / 缺符号在启动期即暴露）
  runSelfCheck('pstd', {
    sourceFiles: ['lib/index.js'],
    requiredSymbols: ['defineTool', 'runSelfCheck'],
    config: config,
  })
  const definitions = createDefinitions(ctx)
  // 入口名一致性门：注册名必须与 standard.js 的 TOOL_NAMES 逐字一致（改名会破坏 R047 账本引用）
  const declared = definitions.map((d) => d.name)
  if (declared.join(',') !== TOOL_NAMES.join(',')) {
    throw new Error('注册定义与 TOOL_NAMES 不一致（R047 按 plugin_name_gate 引用执行点，禁止改名）：' + declared.join(','))
  }
  for (const definition of definitions) {
    ctx.effect(
      () => ctx.tools.register(defineTool(definition)),
      'pstd: ' + definition.name,
    )
  }
}
