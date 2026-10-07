// dsh-plugin-pstd · lib/scaffold.js
// P1–P5 模式化交付：pathGate / gateScaffold / inlineFor / buildFiles（签名与动态版一致）。
// 结构约束：模式与动作全为冻结枚举；写盘分支只存在于 P2/P3；
// 写盘须 dryRun=false + confirm=true；目标目录非空一律拒写（本工具无覆盖能力）。
import { PATTERN_IDS, PLUGIN_PREFIX, STD_ID } from './standard.js'
import { deriveIds, slugIssues, toSlug, toolIssues } from './naming.js'
import { byteLen, fnv, listEntriesOn, resolveBase, scanRegistry, tryResolve } from './fsops.js'
import {
  changelogMd, cliJs, coreJs, gateJs, indexJs, patchYml, pkgJson, pkgJsonCli, readmeMd, selfcheckJs,
} from './templates.js'

export function blocked(gate, reason, fix) {
  return { ok: false, blocked: true, gate: gate, reason: reason, fix: fix || null }
}

export function pathGate(base, dirPath, outRoot) {
  const prefix = outRoot === 'devices'
    ? base + '/dsh-collab/devices/' + PLUGIN_PREFIX
    : base + '/' + PLUGIN_PREFIX
  if (!dirPath.startsWith(prefix)) {
    return { ok: false, reason: '目标不在白名单根下：' + dirPath + '（前缀须为 ' + prefix + '）', fix: '只允许 home 或 devices 两个根，见 outRoot 枚举' }
  }
  if (dirPath.indexOf('..') !== -1) return { ok: false, reason: '路径含父目录片段', fix: null }
  if (dirPath.indexOf('//') !== -1) return { ok: false, reason: '路径含连续斜杠', fix: null }
  return { ok: true, prefix: prefix }
}

export function inlineHostCode(def, purpose, toolsList) {
  const names = toolsList.map((t) => '"' + t + '"').join(', ')
  return '// P1 宿主工具片段 · PSTD ' + STD_ID + ' · 交给 cordis_define 的 code.host\n'
    + '// 命名：包 ' + def.packageName + ' · idPrefix ' + def.idPrefix + ' · 工具 ' + names + '\n'
    + 'const TOOL_NAMES = [' + names + ']\n'
    + 'return {\n'
    + '  apply(ctx) {\n'
    + '    for (const toolName of TOOL_NAMES) {\n'
    + '      ctx.effect(\n'
    + '        () =>\n'
    + '          harness.registerTool(ctx, harness.defineTool({\n'
    + '            name: toolName,\n'
    + '            description: "' + purpose + '",\n'
    + '            parameters: {\n'
    + '              action: { type: "string", required: true, enum: ["status", "explain"], description: "动作；枚举即约束" },\n'
    + '            },\n'
    + '            output: {\n'
    + '              schema: { type: "json" },\n'
    + '              render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],\n'
    + '            },\n'
    + '            async execute(args) {\n'
    + '              return { ok: true, tool: toolName, action: args.action }\n'
    + '            },\n'
    + '          })),\n'
    + '        "' + def.slug + ': " + toolName,\n'
    + '      )\n'
    + '    }\n'
    + '  },\n'
    + '}\n'
    + '// 注意（R006 ① 第 5 项）：交付前必须真挂载一次并断言注册到的工具名，而不是只 import 源码。\n'
}

export function inlineClientCode(def, purpose) {
  return '// P4 客户端片段 · 交给 cordis_define 的 code.client（需授权：单勾=仅本 Package，双勾=该插件后续版本）\n'
    + '// 落盘前先用 cordis_inspect_query(client, Slots, listSubTree) 取真实 Slot 契约，勿照抄猜测。\n'
    + 'return {\n'
    + '  apply(ctx) {\n'
    + '    const slots = ctx.get("slots")\n'
    + '    if (slots === undefined) return\n'
    + '    slots.inject("tool.view.cordis", () =>\n'
    + '      slots.register({ name: "tool.view.cordis", key: "self" }, (props) =>\n'
    + '        React.createElement(\n'
    + '          "div",\n'
    + '          { style: { padding: "12px", fontSize: "13px" } },\n'
    + '          React.createElement("div", null, "' + purpose + '"),\n'
    + '          React.createElement("div", { style: { opacity: 0.7, marginTop: "6px" } }, String(props.packageId)),\n'
    + '        ),\n'
    + '      ),\n'
    + '    )\n'
    + '  },\n'
    + '}\n'
    + '// 宿主侧可另配私有 RPC：host 用 harness.handle(name, handler)，client 用 host.call(name, args)。\n'
}

export function remediationPlan() {
  return [
    'P5 审查—整改闭环 · 只补缺项、不重写（R006 §8 执行原则）',
    '归属优先：插件属其它会话时由属主补，不代改；补课不夹带其它改动。',
    '',
    '步骤：',
    '1. 先跑审查取得逐项证据：plugin_review(target="<目录>", deep=true)',
    '2. 按缺口分组：P0（涉及不该发生路径：部署/重启/发布/凭据）→ P1（审查类）→ P2（数据/报告类）',
    '3. 逐项补课（多数只缺 ②⑥⑦⑩，不要重写）',
    '4. 补 ① 第 5 项真挂载冒烟：必须含真 import + 桩 ctx 调 apply + 断言注册结果，三态分开报',
    '5. 复跑审查对比 score；登记到 R006 §8 表格',
    '',
    '常见缺项与补法：',
    '  R2 无自检 → 加 lib/selfcheck.js + --selfcheck（三段输出）',
    '  R6 两处版本 → 删源码内 VERSION 常量，CLI 改从 package.json 读',
    '  R7 无日志 → 按 ~/dsh-collab/logs/<tool>.log 落盘，失败分支也要写',
    '  R10 无门 → 冻结枚举 + 负例矩阵 + 命令白名单 + --lean4-check 六项',
  ].join('\n')
}

// buildFiles(patternId, def, purpose, toolsList) —— 签名与动态版完全一致（等价性比对入口）
export function buildFiles(patternId, def, purpose, toolsList) {
  const files = []
  const add = (path, content) => files.push({ path: path, content: content, bytes: byteLen(content), fingerprint: fnv(content) })
  if (patternId === 'P2_bundled_plugin') {
    add('package.json', pkgJson(def, purpose, toolsList))
    add('cordis.patch.yml', patchYml(def, purpose))
    add('lib/index.js', indexJs(def, purpose, toolsList))
    add('lib/gate.js', gateJs(def))
    add('lib/core.js', coreJs(def, purpose))
    add('lib/selfcheck.js', selfcheckJs(def, purpose))
    add('cli.js', cliJs(def, purpose))
    add('docs/README.md', readmeMd(def, purpose, patternId))
    add('CHANGELOG.md', changelogMd(def, purpose, patternId))
  } else if (patternId === 'P3_cli_tool') {
    add('package.json', pkgJsonCli(def, purpose))
    add('cli.js', cliJs(def, purpose))
    add('lib/gate.js', gateJs(def))
    add('lib/core.js', coreJs(def, purpose))
    add('lib/selfcheck.js', selfcheckJs(def, purpose))
    add('docs/README.md', readmeMd(def, purpose, patternId))
    add('CHANGELOG.md', changelogMd(def, purpose, patternId))
  }
  return files
}

export function inlineFor(patternId, def, purpose, toolsList) {
  if (patternId === 'P1_host_tool') return { host: inlineHostCode(def, purpose, toolsList) }
  if (patternId === 'P4_host_client') return { host: inlineHostCode(def, purpose, toolsList), client: inlineClientCode(def, purpose) }
  if (patternId === 'P5_review_remediate') return { plan: remediationPlan() }
  return null
}

export async function findExistingSlug(ctx) {
  const info = await resolveBase(ctx, null)
  if (info.base === null) return null
  const roots = await scanRegistry(ctx, info.base)
  for (const root of roots) {
    for (const entry of root.entries) {
      if (slugIssues(entry.slug).length > 0) continue
      const list = await listEntriesOn(ctx.get('fs'), entry.path)
      if (list !== null && list.length > 0) return entry.slug
    }
  }
  return null
}

export async function gateScaffold(ctx, req) {
  const fs = ctx.get('fs')
  if (fs === undefined || fs === null) return blocked('ENV', 'fs 服务不可用', null)
  const patternId = String(req.pattern == null ? '' : req.pattern)
  if (PATTERN_IDS.indexOf(patternId) === -1) {
    return blocked('SCHEMA_GATE', '模式不在冻结枚举内：' + patternId, '允许值：' + PATTERN_IDS.join(', '))
  }
  const rawSlug = String(req.slug == null ? '' : req.slug)
  if (rawSlug.indexOf('/') !== -1 || rawSlug.indexOf('..') !== -1 || rawSlug.indexOf('\\') !== -1) {
    return blocked('PATH_GATE', 'slug 不得含路径分隔符或父目录片段：' + rawSlug, '只传 slug（如 my-tool），不要传路径')
  }
  const slug = toSlug(rawSlug)
  const issues = slugIssues(slug)
  if (issues.length > 0) {
    return blocked('NAME_GATE', '命名门未通过：' + issues.map((i) => i.rule + ' ' + i.detail).join('；'),
      '先用 plugin_name_gate action=allocate 取得合规 slug（或 action=check 复核）')
  }
  const toolsList = Array.isArray(req.tools) ? req.tools.map((t) => String(t)) : []
  const badTools = []
  for (const name of toolsList) {
    const ti = toolIssues(name, [], [])
    if (ti.length > 0) badTools.push({ tool: name, issues: ti.map((x) => x.detail) })
  }
  if (badTools.length > 0) {
    return blocked('NAME_GATE', '工具名不合 N4：' + JSON.stringify(badTools),
      '工具名形如 <领域>_<动作>[_<对象>]，snake_case，1–3 段下划线，首段=领域前缀')
  }
  const outRoot = req.outRoot === 'devices' ? 'devices' : 'home'
  const info = await resolveBase(ctx, req.base)
  if (info.base === null) return blocked('ENV', info.error, '用 base 参数显式指定插件根目录（例如 /Users/<you>）')
  const dirPath = outRoot === 'devices'
    ? info.base + '/dsh-collab/devices/' + PLUGIN_PREFIX + slug
    : info.base + '/' + PLUGIN_PREFIX + slug
  const gate = pathGate(info.base, dirPath, outRoot)
  if (gate.ok !== true) return blocked('PATH_GATE', gate.reason, gate.fix)
  const def = deriveIds(slug)
  let finalTools = toolsList
  if (finalTools.length === 0) finalTools = [def.toolDomain + '_status']
  const badDefault = []
  for (const name of finalTools) {
    const ti = toolIssues(name, [], [])
    if (ti.length > 0) badDefault.push(name)
  }
  if (badDefault.length > 0) {
    return blocked('NAME_GATE', '默认工具名不合 N4（请显式传 tools）：' + badDefault.join(', '),
      '显式传 tools，例如 ["' + def.toolDomain + '_scan"]')
  }

  if (req.dryRun !== false) {
    const files = buildFiles(patternId, def, String(req.purpose || ''), finalTools)
    return {
      ok: true, mode: 'dry-run', writes: 0, pattern: patternId, def: def, outRoot: outRoot, dir: dirPath,
      plan: files.map((f) => ({ path: dirPath + '/' + f.path, relPath: f.path, bytes: f.bytes, fingerprint: f.fingerprint })),
      inline: files.length === 0 ? inlineFor(patternId, def, String(req.purpose || ''), finalTools) : null,
      next: files.length === 0
        ? ['本模式不写盘：把返回的片段交给 cordis_define / 按 plan 人工整改']
        : ['确认无误后用 dryRun=false + confirm=true 落盘', '落盘后跑 plugin_review(target="' + def.packageName + '", deep=true)'],
    }
  }
  if (req.confirm !== true) {
    return blocked('ENTRY_GATE', 'dryRun=false 时必须 confirm=true（入口门：写盘是本工具唯一的受控入口，需显式二次确认）',
      '先看 dry-run 计划，再 confirm=true 落盘')
  }
  const existing = await listEntriesOn(fs, dirPath)
  if (existing !== null && existing.length > 0) {
    return blocked('EXISTS_GATE', dirPath + ' 已存在且非空（' + existing.length + ' 项）',
      '本工具无覆盖能力：请换 slug，或人工处理既有交付物')
  }

  const files = buildFiles(patternId, def, String(req.purpose || ''), finalTools)
  if (files.length === 0) {
    return {
      ok: true, mode: 'inline', writes: 0, pattern: patternId, def: def, dir: dirPath,
      inline: inlineFor(patternId, def, String(req.purpose || ''), finalTools),
      next: ['本模式没有写盘分支（结构性：该分支下的代码路径中不存在写调用）', '把片段交给 cordis_define；含 client 的 Package 需要用户授权'],
    }
  }
  const written = []
  const failures = []
  for (const file of files) {
    const target = await tryResolve(fs, dirPath + '/' + file.path)
    if (target === null) {
      failures.push({ path: file.path, error: '目标无法解析' })
      continue
    }
    try {
      const outcome = await fs.writeText(target, file.content)
      const info2 = await fs.stat(target)
      written.push({
        path: dirPath + '/' + file.path,
        operation: outcome && outcome.operation ? outcome.operation : null,
        bytes: file.bytes,
        verified: !!(info2 && info2.type === 'file' && info2.size === file.bytes),
      })
    } catch (err) {
      failures.push({ path: file.path, error: String((err && err.message) || err) })
    }
  }
  return {
    ok: failures.length === 0, mode: 'written', pattern: patternId, def: def, dir: dirPath,
    written: written, failures: failures, writes: written.length,
    next: [
      'node cli.js --selfcheck（必须在 ' + dirPath + ' 内跑，依赖才解析得到）',
      'node cli.js --lean4-check',
      'plugin_review(target="' + def.packageName + '", deep=true)',
      '补 ⑦ 统一日志（' + def.logPath + '）与 ⑧ 登记卡（' + def.registryKey + '，写后回读确认）',
    ],
  }
}
