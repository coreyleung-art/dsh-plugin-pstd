// dsh-plugin-pstd · lib/review.js
// R006 十项审查：把插件目录读成证据，逐项出判据/证据/整改动作。
// 判据可机械核验；无网络能力时如实标「未实测」，不假装通过。
import { DANGER_PRIMITIVES, PLUGIN_PREFIX, R006_ITEMS, STD_ID } from './standard.js'
import { slugIssues, toolIssues } from './naming.js'
import { byteLen, collect, listEntriesOn, liveToolNames, resolveBase, runSmoke, statOf } from './fsops.js'

// 宿主私有路径的特征串：刻意用片段拼接，使本包源码不出现这些字面量（无宿主私有依赖，
// 但仍能在别人的源码里检出它们）。行为与动态版一致。
const HOST_PRIVATE_MARKERS = Object.freeze(['dsh' + '-runtime', 'CLD' + '.app'])

// 修复(v1.0.1)：YAML 列表项写作 "- id: x"，必须吃掉 "- " 前缀，否则全部插件误报 id=null
export function patchRow(text) {
  if (typeof text !== 'string') return null
  const idMatch = /(?:^|\n)[ \t]*-?[ \t]*id[ \t]*:[ \t]*([^\n#]+)/.exec(text)
  const nameMatch = /(?:^|\n)[ \t]*-?[ \t]*name[ \t]*:[ \t]*([^\n#]+)/.exec(text)
  return {
    id: idMatch ? idMatch[1].trim().replace(/^["']|["']$/g, '') : null,
    name: nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : null,
    hasInsert: /-\s*insert\s*:/.test(text),
  }
}

// 扫源码前先剥注释/字符串/正则字面量，否则会把自己的检测正则当靶子（R006 坑#2）
// ★ 单遍字符扫描器，不是链式 replace：链式做法里「先剥行注释」会把字符串内的 // 当成注释起点，
//   于是删掉该行尾的引号、后续引号两两错配，把整段**代码**当成字符串吃掉（实测造成 A 项假阳性、D/F 项找不到锚点）。
const REGEX_ALLOWED_BEFORE = '=(,:[!&|?{};+-*%~^<>'

function prevMeaningful(text, idx) {
  for (let k = idx - 1; k >= 0; k -= 1) {
    const ch = text[k]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue
    return ch
  }
  return ''
}

export function stripNoise(src) {
  const text = String(src)
  const out = []
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i += 1
      out.push(' ')
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      out.push(' ')
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i += 1
      while (i < n) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === quote) { i += 1; break }
        i += 1
      }
      out.push(quote === '`' ? '``' : quote + quote)
      continue
    }
    if (c === '/') {
      const prev = prevMeaningful(text, i)
      if (prev === '' || REGEX_ALLOWED_BEFORE.indexOf(prev) !== -1) {
        // 正则字面量：跳到未转义的收尾斜杠，尊重字符类 […]
        i += 1
        let inClass = false
        let closed = false
        while (i < n) {
          const ch = text[i]
          if (ch === '\\') { i += 2; continue }
          if (ch === '\n') break
          if (ch === '[') inClass = true
          else if (ch === ']') inClass = false
          else if (ch === '/' && !inClass) { i += 1; closed = true; break }
          i += 1
        }
        if (closed) {
          while (i < n && /[a-z]/.test(text[i])) i += 1
          out.push(' ')
          continue
        }
      }
      out.push(c)
      i += 1
      continue
    }
    out.push(c)
    i += 1
  }
  return out.join('')
}

export function dangerHits(src) {
  const cleaned = src === null || src === undefined ? '' : stripNoise(src)
  const lines = cleaned.split('\n')
  const hits = []
  for (const primitive of DANGER_PRIMITIVES) {
    const lineNos = []
    for (let i = 0; i < lines.length; i += 1) {
      if (primitive.re.test(lines[i])) lineNos.push(i + 1)
    }
    if (lineNos.length > 0) hits.push({ primitive: primitive.name, count: lineNos.length, lines: lineNos.slice(0, 8) })
  }
  return hits
}

export function markers(src, needles) {
  const text = String(src == null ? '' : src)
  const present = []
  const missing = []
  for (const needle of needles) {
    if (text.indexOf(needle) !== -1) present.push(needle)
    else missing.push(needle)
  }
  return { present: present, missing: missing }
}

export function importSpecifiers(src) {
  const out = []
  const text = String(src == null ? '' : src)
  const re = /(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g
  let m = re.exec(text)
  while (m !== null) {
    if (out.indexOf(m[1]) === -1) out.push(m[1])
    m = re.exec(text)
  }
  return out
}

export function declaredToolNames(data) {
  const out = []
  const src = [data.mainSrc, data.core, data.cli].filter((x) => typeof x === 'string').join('\n')
  const re = /name\s*:\s*["']([a-z][a-z0-9_]*)["']/g
  let m = re.exec(src)
  while (m !== null) {
    if (m[1].indexOf('_') !== -1 && out.indexOf(m[1]) === -1) out.push(m[1])
    m = re.exec(src)
  }
  return out
}

// 命名审计：N1/N2/N3 判实据；N4 只判形式（已挂载插件自己的工具出现在活体表里是正常的）
export async function namingReview(ctx, dirPath, dirName) {
  const fs = ctx.get('fs')
  const slug = dirName.startsWith(PLUGIN_PREFIX) ? dirName.slice(PLUGIN_PREFIX.length) : dirName
  const results = []
  const push = (rule, verdict, detail) => results.push({ rule: rule, verdict: verdict, detail: detail })

  const issues = slugIssues(slug)
  if (dirName.startsWith(PLUGIN_PREFIX)) {
    push('N1', issues.length === 0 ? 'pass' : 'fail',
      issues.length === 0 ? '目录名 ' + dirName + ' 合规' : issues.map((i) => i.detail).join('；'))
  } else {
    push('N1', 'fail', '目录名未带 ' + PLUGIN_PREFIX + ' 前缀：' + dirName)
  }

  const data = await collect(fs, dirPath)
  const expectedPkg = PLUGIN_PREFIX + slug
  if (data.pkg === null) push('N2', 'fail', data.pkgError || 'package.json 不可读')
  else {
    push('N2', data.pkg.name === dirName ? 'pass' : 'fail',
      'package.json name = ' + String(data.pkg.name) + '，目录名 = ' + dirName +
      (data.pkg.name === dirName ? '' : '（应为 ' + expectedPkg + '）'))
  }

  const row = patchRow(data.patch)
  if (row === null) push('N3', 'fail', 'cordis.patch.yml 缺失或不可读')
  else {
    const problems = []
    if (!row.hasInsert) problems.push('缺 - insert: 行')
    if (row.id !== slug) problems.push('id = ' + String(row.id) + '，应为 ' + slug)
    if (row.name !== expectedPkg) problems.push('name = ' + String(row.name) + '，应为 ' + expectedPkg)
    push('N3', problems.length === 0 ? 'pass' : 'fail',
      problems.length === 0 ? '插件行 id=' + String(row.id) + ' / name=' + String(row.name) + ' 一致' : problems.join('；'))
  }

  const declared = declaredToolNames(data)
  const live = liveToolNames(ctx)
  if (declared.length === 0) push('N4', 'unverified', '静态未识别到工具名声明（可能为动态注册）')
  else {
    const bad = []
    for (const name of declared) {
      const ti = toolIssues(name, [], [])
      if (ti.length > 0) bad.push(name + ': ' + ti.map((x) => x.detail).join('、'))
    }
    const inLive = declared.filter((n) => live.indexOf(n) !== -1)
    let detail = bad.length === 0 ? '工具名 ' + declared.length + ' 个形式全部合规：' + declared.join(', ') : bad.join('；')
    if (inLive.length > 0) detail += '；其中 ' + inLive.length + ' 个当前在活体表中（本插件已挂载的自证；新起的同名才需人工确认归属）'
    push('N4', bad.length === 0 ? 'pass' : 'fail', detail)
  }

  return {
    slug: slug, dirName: dirName, dirPath: dirPath, rules: results,
    verdict: results.some((r) => r.verdict === 'fail') ? 'fail' : results.some((r) => r.verdict === 'unverified') ? 'partial' : 'pass',
  }
}

export async function reviewOne(ctx, dirPath, options) {
  const fs = ctx.get('fs')
  const data = await collect(fs, dirPath)
  const items = []
  const add = (id, verdict, evidence, fix) => {
    const meta = R006_ITEMS.find((x) => x.id === id)
    items.push({
      id: id, grade: meta ? meta.grade : '?', name: meta ? meta.name : id, verdict: verdict,
      evidence: evidence, fix: verdict === 'pass' ? null : (fix || (meta ? meta.fix : null)),
    })
  }
  const pkg = data.pkg

  // R1 dsh 插件形态 + ★真挂载冒烟
  {
    const subs = []
    subs.push({ key: 'type=module', ok: !!(pkg && pkg.type === 'module') })
    subs.push({ key: 'main', ok: !!(pkg && typeof pkg.main === 'string') })
    subs.push({ key: 'version', ok: !!(pkg && typeof pkg.version === 'string') })
    subs.push({ key: 'dsh.bundle.patch', ok: !!(pkg && pkg.dsh && pkg.dsh.bundle && typeof pkg.dsh.bundle.patch === 'string') })
    const row = patchRow(data.patch)
    subs.push({ key: 'cordis.patch.yml:insert', ok: !!(row && row.hasInsert) })
    subs.push({ key: '入口导出 apply', ok: typeof data.mainSrc === 'string' && /apply/.test(data.mainSrc) })
    let clientNote = null
    if (pkg && pkg.dsh && pkg.dsh.client) {
      clientNote = pkg.exports && pkg.exports['./client'] ? './client 出口已声明' : (data.client !== null ? 'lib/client.js 存在' : '缺失')
      subs.push({ key: 'client 真实出口', ok: clientNote !== '缺失' })
    }
    let smoke = { state: 'skipped', reason: '未启用 deep（不运行 node）' }
    if (options.deep === true) smoke = await runSmoke(ctx, fs, dirPath, data.mainRel)
    const staticFail = subs.filter((s) => s.ok === false).length
    let verdict = 'pass'
    if (staticFail > 0) verdict = 'fail'
    else if (smoke.state === 'fail') verdict = 'fail'
    else if (smoke.state !== 'pass') verdict = 'partial'
    const evidence = subs.map((s) => (s.ok ? '✓ ' : '✗ ') + s.key)
    evidence.push('★真挂载冒烟: ' + smoke.state + (smoke.reason ? '（' + smoke.reason + '）' : '') +
      (smoke.registered && smoke.registered.length > 0 ? '，注册 ' + smoke.registered.length + ' 项: ' + smoke.registered.slice(0, 6).join(', ') : ''))
    if (clientNote !== null) evidence.push('client: ' + clientNote)
    add('R1', verdict, evidence, smoke.state === 'skipped' && options.deep !== true ? '用 deep=true 重跑以取得真挂载冒烟证据（R006 ① 第 5 项硬项）' : null)
  }

  // R2 TCC
  {
    const hasFile = data.selfcheck !== null
    const hasFlag = typeof data.cli === 'string' && data.cli.indexOf('--selfcheck') !== -1
    // 按「段」计数（中英任一命中即该段覆盖），不把中英标记相加 —— 否则会出现 6/3 这种自相矛盾的显示
    const pairs2 = [['能力', 'capabilit'], ['不该发生', 'forbidden'], ['依赖', 'dependenc']]
    const text2 = typeof data.selfcheck === 'string' ? data.selfcheck : ''
    const covered = pairs2.filter((p) => text2.indexOf(p[0]) !== -1 || text2.indexOf(p[1]) !== -1).length
    if (!hasFile && !hasFlag) add('R2', 'fail', ['✗ 无 lib/selfcheck.js，也未在 cli 中实现 --selfcheck'], null)
    else {
      add('R2', covered >= 2 ? 'pass' : 'partial', [
        'selfcheck 文件: ' + (hasFile ? '有' : '无'),
        '--selfcheck 旗标: ' + (hasFlag ? '有' : '无'),
        '三段覆盖: ' + covered + '/3（能力清单/不该发生路径/依赖完整性）',
      ], null)
    }
  }

  // R3 CLD 自适应
  {
    const hits = []
    const pairs = [['lib/index.js', data.mainSrc], ['cli.js', data.cli]]
    for (const pair of pairs) {
      const text = pair[1]
      if (typeof text !== 'string') continue
      for (const spec of importSpecifiers(text)) {
        if (spec.startsWith('.')) {
          if (/\.\.\/\.\.\/\.\./.test(spec)) hits.push(pair[0] + ' 深层相对引用 ' + spec)
        } else if (HOST_PRIVATE_MARKERS.some((m) => spec.indexOf(m) !== -1)) {
          hits.push(pair[0] + ' 宿主私有路径 ' + spec)
        }
      }
      if (HOST_PRIVATE_MARKERS.some((m) => text.indexOf(m) !== -1)) hits.push(pair[0] + ' 含宿主私有路径字面量')
    }
    add('R3', hits.length === 0 ? 'pass' : 'fail', hits.length === 0 ? ['✓ 未发现宿主私有路径引用'] : hits.map((h) => '✗ ' + h), null)
  }

  // R4 dsh 版本自适应
  {
    const peers = pkg && pkg.peerDependencies && typeof pkg.peerDependencies === 'object' ? Object.keys(pkg.peerDependencies) : []
    const used = []
    for (const text of [data.mainSrc, data.cli, data.core]) {
      if (typeof text !== 'string') continue
      for (const spec of importSpecifiers(text)) {
        if (spec.startsWith('@deepseek-ai/')) used.push(spec.split('/').slice(0, 2).join('/'))
      }
    }
    const uniq = used.filter((x, i) => used.indexOf(x) === i)
    const missing = uniq.filter((u) => peers.indexOf(u) === -1)
    const evidence = [
      'peerDependencies: ' + (peers.length > 0 ? peers.join(', ') : '（无）'),
      '代码 import 的 @deepseek-ai 包: ' + (uniq.length > 0 ? uniq.join(', ') : '（无）'),
    ]
    if (missing.length > 0) evidence.push('✗ 未声明 peer: ' + missing.join(', '))
    let verdict = 'pass'
    if (uniq.length > 0 && peers.length === 0) verdict = 'fail'
    else if (missing.length > 0) verdict = 'partial'
    else if (uniq.length === 0) verdict = 'partial'
    add('R4', verdict, evidence, null)
  }

  // R5 文档化
  {
    const documented = pkg && pkg.r006 && typeof pkg.r006.documented === 'string' ? pkg.r006.documented : null
    const readme = data.readme
    const hasReadme = typeof readme === 'string' && readme.length > 200
    const m = hasReadme ? markers(readme, ['复现', '--selfcheck', '退出码']) : { present: [], missing: [] }
    const evidence = [
      'r006.documented: ' + (documented || '（未声明）'),
      'README: ' + (hasReadme ? byteLen(readme) + ' 字节' : '缺失或过短'),
      '文档要素命中: ' + m.present.length + '/3',
    ]
    add('R5', hasReadme && documented && m.present.length >= 2 ? 'pass' : hasReadme ? 'partial' : 'fail', evidence, null)
  }

  // R6 版本管理
  {
    const version = pkg && typeof pkg.version === 'string' ? pkg.version : null
    const evidence = ['package.json version: ' + (version || '缺失')]
    const second = []
    const pairs = [['lib/index.js', data.mainSrc], ['cli.js', data.cli], ['lib/core.js', data.core]]
    for (const pair of pairs) {
      if (typeof pair[1] !== 'string') continue
      if (/VERSION\s*=\s*["']\d+\.\d+\.\d+["']/.test(stripNoise(pair[1]))) second.push(pair[0])
    }
    evidence.push(second.length > 0 ? '✗ 第二处版本常量: ' + second.join(', ') : '✓ 未发现第二处硬编码版本常量')
    evidence.push('CHANGELOG.md: ' + (typeof data.changelog === 'string' ? '有' : '缺失'))
    const verdict = version === null ? 'fail' : second.length > 0 ? 'fail' : typeof data.changelog === 'string' ? 'pass' : 'partial'
    add('R6', verdict, evidence, null)
  }

  // R7 统一日志
  {
    const unified = pkg && pkg.r006 && typeof pkg.r006.unified_log === 'string' ? pkg.r006.unified_log : null
    const info = await resolveBase(ctx, null)
    let logExists = 'unknown'
    if (unified !== null && info.base !== null) {
      const clean = unified.replace(/^~\//, '')
      const info2 = await statOf(fs, info.base + '/' + clean)
      logExists = info2 && info2.type === 'file' ? 'yes' : 'no'
    }
    const matchesConvention = unified !== null && /^~\/dsh-collab\/logs\/.+\.log$/.test(unified)
    const evidence = [
      'r006.unified_log: ' + (unified || '（未声明）'),
      '路径符合约定: ' + (matchesConvention ? '是' : '否'),
      '日志文件实测: ' + logExists,
    ]
    const verdict = unified === null ? 'fail' : !matchesConvention ? 'partial' : logExists === 'yes' ? 'pass' : 'partial'
    add('R7', verdict, evidence, unified === null ? '在 package.json r006.unified_log 声明 ~/dsh-collab/logs/<tool>.log（R006 ⑦）' : null)
  }

  // R8 自动落链（无网络能力 → 如实标未实测）
  {
    const chain = pkg && pkg.r006 && typeof pkg.r006.auto_chain === 'string' ? pkg.r006.auto_chain : null
    const slug = dirPath.split('/').pop().replace(PLUGIN_PREFIX, '')
    const evidence = [
      'r006.auto_chain: ' + (chain || '（未声明）'),
      '约定登记卡键: data/registry/' + PLUGIN_PREFIX + slug,
      '本审查员无网络能力 → 黑板落链未实测（不假装通过）',
    ]
    add('R8', chain !== null ? 'partial' : 'fail', evidence,
      '补黑板登记卡并回读确认：curl -s http://127.0.0.1:8792/data/registry/' + PLUGIN_PREFIX + slug + ' 应返回 200 且 value 非空')
  }

  // R9 CLI 治理
  {
    const hasCli = typeof data.cli === 'string' || !!(pkg && pkg.bin && typeof pkg.bin === 'object')
    if (!hasCli) add('R9', 'skipped', ['无 cli.js 且 package.json 无 bin —— 纯插件形态，⑨ 不适用（如实标记跳过）'], null)
    else {
      const text = typeof data.cli === 'string' ? data.cli : ''
      const m = markers(text, ['--dry-run', '--json', '--help', '--selfcheck', '--lean4-check', '--tool-version'])
      const exit2 = /exit\s+2|return\s+2/.test(text)
      const evidence = [
        '旗标命中: ' + (m.present.length > 0 ? m.present.join(', ') : '无') + (m.missing.length > 0 ? ' | 缺: ' + m.missing.join(', ') : ''),
        '退出码 2（用法错误）: ' + (exit2 ? '有' : '未识别'),
      ]
      const score = m.present.length + (exit2 ? 1 : 0)
      add('R9', score >= 6 ? 'pass' : score >= 3 ? 'partial' : 'fail', evidence, null)
    }
  }

  // R10 约束门
  {
    const hasGate = data.gate !== null
    const hasLean = typeof data.cli === 'string' && data.cli.indexOf('--lean4-check') !== -1
    const frozen = [data.gate, data.mainSrc, data.cli].some((t) => typeof t === 'string' && /Object\.freeze/.test(t))
    const found = []
    const pairs = [['lib/index.js', data.mainSrc], ['cli.js', data.cli], ['lib/gate.js', data.gate], ['lib/core.js', data.core]]
    for (const pair of pairs) {
      if (typeof pair[1] !== 'string') continue
      for (const hit of dangerHits(pair[1])) {
        found.push({
          where: pair[0], primitive: hit.primitive, count: hit.count, lines: hit.lines.slice(0, 5),
          text: pair[0] + ' ' + hit.primitive + ' ×' + hit.count + '（行 ' + hit.lines.slice(0, 5).join(',') + '）',
        })
      }
    }
    // 分类：process.exit 是 ⑨「退出码语义固定」所必需，把它与真危险原语分开报，否则任何合规 CLI 永远红。
    // 注意：这**不**放过「失败也 exit 0」——那个是退出码语义问题，文本判不出，需人工确认（本条如实标出）。
    const cliExitHits = found.filter((h) => h.primitive === 'process.exit')
    const hardHits = found.filter((h) => h.primitive !== 'process.exit')
    const evidence = [
      'lib/gate.js: ' + (hasGate ? '有' : '无'),
      '--lean4-check: ' + (hasLean ? '有' : '无'),
      'Object.freeze（冻结白名单）: ' + (frozen ? '有' : '无'),
      '危险原语扫描（已剥离注释/字符串/正则）: ' + (
        found.length === 0
          ? '0 命中'
          : hardHits.length + ' 类需人工确认' + (cliExitHits.length > 0 ? ' + ' + cliExitHits.length + ' 类归类为 CLI 退出码语义' : '')
      ),
    ]
    for (const h of hardHits.slice(0, 5)) evidence.push('  · ' + h.text)
    for (const h of cliExitHits.slice(0, 3)) {
      evidence.push('  ~ ' + h.text + '（⑨ 要求固定退出码语义，故不计入红灯；「失败也 exit 0」需人工确认）')
    }
    const gateOk = hasGate || hasLean
    add('R10', gateOk && frozen && hardHits.length === 0 ? 'pass' : gateOk ? 'partial' : 'fail', evidence, null)
  }

  const passCount = items.filter((i) => i.verdict === 'pass').length
  const failCount = items.filter((i) => i.verdict === 'fail').length
  return {
    target: dirPath,
    dirName: dirPath.split('/').pop(),
    std: STD_ID,
    score: passCount + '/10',
    verdict: passCount === 10 ? '达标' : failCount === 0 ? '接近达标（有待证项）' : '未达标',
    pkgVersion: pkg && pkg.version ? pkg.version : null,
    items: items,
  }
}
