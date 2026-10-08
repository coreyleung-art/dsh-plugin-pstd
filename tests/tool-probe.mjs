// 作者侧工具探针（durable：不再放 /tmp —— 2026-10-08 电力故障重启把 /tmp 版本清掉，教训）
//
// 用途：在无宿主的环境里用最小 fs 垫片调起本包的 5 个工具，检查
//   ① 切片动作（norms/r006/patterns/gates/all/selfproof）无 undefined、JSON 往返一致
//   ② R8 证据文案（v1.0.4 修错项：须为「未实现」而非「无网络能力」）
//   ③ selfTools 顾问位正反差
// 不进 lib/ 运行时路径，不被 lib/index.js 引用，属作者自查件。
// 用法：/opt/homebrew/bin/node tests/tool-probe.mjs
import { pathToFileURL } from 'node:url'
import { stat as fstat, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const PKG = path.dirname(path.dirname(new URL(import.meta.url).pathname))
const expand = (p) => { const t = String(p); if (t === '~') return os.homedir(); if (t.startsWith('~/')) return path.join(os.homedir(), t.slice(2)); return t }

const fsService = {
  async resolve(p) { return { targetKey: path.resolve(expand(p)), displayPath: String(p) } },
  processPath(t) { return t.targetKey },
  fileUrl(t) { return pathToFileURL(t.targetKey).href },
  contains(a, b) { const r = path.relative(a.targetKey, b.targetKey); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)) },
  async stat(t) { try { const s = await fstat(t.targetKey); return { version: String(s.mtimeMs), type: s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other', size: s.size } } catch { return undefined } },
  async readText(t) { return await readFile(t.targetKey, 'utf8') },
  async listDir(t) { const n = await readdir(t.targetKey, { withFileTypes: true }); return n.sort((a, b) => (a.name < b.name ? -1 : 1)).map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other', target: { targetKey: path.join(t.targetKey, e.name), displayPath: e.name } })) },
  async writeText(t, c) { await mkdir(path.dirname(t.targetKey), { recursive: true }); await writeFile(t.targetKey, c, 'utf8'); return { operation: 'create', version: 'v' } },
}

const mod = await import(pathToFileURL(path.join(PKG, 'lib/index.js')).href)
const cap = []
const services = { fs: fsService, tools: { register: (d) => { cap.push(d); return () => {} }, schemas: () => cap.map((d) => ({ name: d.name })) } }
const ctx = new Proxy({
  tools: services.tools,
  on: () => () => {},
  effect: (cb) => { try { const d = cb(); return typeof d === 'function' ? d : () => {} } catch { return () => {} } },
  get: (n) => services[n],
}, { get: (t, k) => (k in t ? t[k] : () => () => {}) })

await mod.apply(ctx, {})
const byName = Object.fromEntries(cap.map((d) => [d.name, d]))

function scanUndefined(v, p = '$', hits = []) {
  if (v === undefined) hits.push(p)
  else if (Array.isArray(v)) v.forEach((x, i) => scanUndefined(x, p + '[' + i + ']', hits))
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) scanUndefined(v[k], p + '.' + k, hits)
  return hits
}

const out = { pkgVersion: JSON.parse(await readFile(path.join(PKG, 'package.json'), 'utf8')).version, checks: [] }
const chk = (n, ok, d) => out.checks.push({ name: n, ok: !!ok, detail: d ?? null })

for (const action of ['norms', 'r006', 'patterns', 'gates', 'all', 'selfproof']) {
  const r = await byName['plugin_standard'].execute({ action })
  const hits = scanUndefined(r)
  const rt = JSON.stringify(JSON.parse(JSON.stringify(r))) === JSON.stringify(r)
  chk('切片 ' + action, hits.length === 0 && rt && (action !== 'selfproof' || r.ok === true),
    'undefined=' + hits.length + ' | JSON往返=' + rt)
}

// R8 证据文案（v1.0.4 修错回归：必须写「未实现」，不得写「无网络能力」）
const rev = await byName['plugin_review'].execute({ target: 'dsh-plugin-pstd' })
const r8 = rev.items.find((i) => i.id === 'R8')
const ev = JSON.stringify(r8.evidence)
chk('R8 文案=未实现（非无网络）', ev.includes('无自动核验实现') && !ev.includes('无网络能力'), 'evidence=' + ev.slice(0, 120))

const g = byName['plugin_name_gate']
const a = await g.execute({ action: 'check', name: 'probe-newname-1008', tools: ['plugin_standard'], selfTools: ['plugin_standard'] })
const b = await g.execute({ action: 'check', name: 'probe-newname-1008', tools: ['plugin_standard'] })
chk('selfTools 顾问位', a.ok === true && b.ok === false, '带=' + a.ok + ' / 不带=' + b.ok)
chk('工具 5 个齐备', ['plugin_standard', 'plugin_name_gate', 'plugin_review', 'plugin_pattern_list', 'plugin_pattern_scaffold'].every((n) => byName[n]), null)

// judge_skew 回归（v1.0.4 新增字段）：同版本 ⇒ null；异版本 ⇒ 必须告警
const selfRev = await byName['plugin_review'].execute({ target: 'dsh-plugin-pstd' })
chk('judge_skew 自审（同版本）为 null', selfRev.judge_skew === null, 'judge=' + JSON.stringify(selfRev.judge))
const otherRev = await byName['plugin_review'].execute({ target: 'dsh-plugin-guard' })
chk('judge_skew 异版本触发告警',
  otherRev.judge_skew !== null && /不一致/.test(String(otherRev.judge_skew && otherRev.judge_skew.warn)),
  'audited_onDisk=' + (otherRev.judge_skew && otherRev.judge_skew.audited_onDisk) + ' judge=' + (otherRev.judge_skew && otherRev.judge_skew.judge_version))

console.log(JSON.stringify(out, null, 2))
const bad = out.checks.filter((c) => !c.ok)
console.log('\n失败项: ' + bad.length)
process.exit(bad.length === 0 ? 0 : 1)
