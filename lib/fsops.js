// dsh-plugin-pstd · lib/fsops.js
// 文件系统与运行时探针：解析路径/列目录/读文件/根目录探测/注册表扫描/收集插件资料/node 解析/真挂载冒烟。
// 只读叶字段，不整体序列化活体对象。
import {
  COMMAND_WHITELIST, NODE_CANDIDATES, PLUGIN_PREFIX, SMOKE_SCRIPT,
} from './standard.js'

const encoder = new TextEncoder()

export function byteLen(text) {
  return encoder.encode(String(text)).length
}

export function tail(text, n) {
  const s = String(text == null ? '' : text)
  return s.length > n ? s.slice(s.length - n) : s
}

// FNV-1a 32 位指纹：用于模板等价性比对（同输入 → 同指纹）
export function fnv(text) {
  let h = 0x811c9dc5
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return ('00000000' + h.toString(16)).slice(-8)
}

export function shellQuote(text) {
  return "'" + String(text).split("'").join("'\\''") + "'"
}

// 活体工具表（只读叶字段 name）
export function liveToolNames(ctx) {
  const service = ctx.get('tools')
  if (service === undefined || service === null || typeof service.schemas !== 'function') return []
  try {
    const arr = service.schemas()
    if (!Array.isArray(arr)) return []
    const names = []
    for (const schema of arr) {
      if (schema && typeof schema.name === 'string' && schema.name.length > 0) names.push(schema.name)
    }
    return names
  } catch (err) {
    return []
  }
}

export async function tryResolve(fs, path) {
  try {
    return await fs.resolve(path)
  } catch (err) {
    return null
  }
}

export async function statOf(fs, path) {
  const target = await tryResolve(fs, path)
  if (target === null) return null
  try {
    return await fs.stat(target)
  } catch (err) {
    return null
  }
}

export async function readFileAt(fs, path) {
  const target = await tryResolve(fs, path)
  if (target === null) return null
  try {
    const info = await fs.stat(target)
    if (!info || info.type !== 'file') return null
    return await fs.readText(target)
  } catch (err) {
    return null
  }
}

export async function listEntriesOn(fs, path) {
  const target = await tryResolve(fs, path)
  if (target === null) return null
  try {
    const info = await fs.stat(target)
    if (!info || info.type !== 'directory') return null
    const entries = await fs.listDir(target)
    if (!Array.isArray(entries)) return null
    const out = []
    for (const entry of entries) out.push({ name: entry.name, type: entry.type })
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    return out
  } catch (err) {
    return null
  }
}

export async function listDirNames(fs, path) {
  const entries = await listEntriesOn(fs, path)
  return entries === null ? null : entries.filter((e) => e.type === 'directory').map((e) => e.name)
}

// 插件根目录探测：显式 override → sandboxPolicy.workspaceRoot → ~；以「确实存在 dsh-plugin-* 目录」为准
export async function resolveBase(ctx, override) {
  const fs = ctx.get('fs')
  if (fs === undefined || fs === null) {
    return { base: null, error: 'fs 服务不可用：无法扫描插件目录（环境问题，非包问题）', tried: [] }
  }
  const tried = []
  const candidates = []
  if (typeof override === 'string' && override.length > 0) candidates.push(override)
  const policy = ctx.get('sandboxPolicy')
  if (policy && typeof policy.workspaceRoot === 'string' && policy.workspaceRoot.length > 0) candidates.push(policy.workspaceRoot)
  const tilde = await tryResolve(fs, '~')
  if (tilde !== null) {
    let info = null
    try {
      info = await fs.stat(tilde)
    } catch (err) {
      info = null
    }
    if (info && info.type === 'directory') {
      try {
        candidates.push(fs.processPath(tilde))
      } catch (err) {
        // 保留原候选集
      }
    }
  }
  for (const cand of candidates) {
    if (tried.indexOf(cand) !== -1) continue
    tried.push(cand)
    const entries = await listEntriesOn(fs, cand)
    if (entries === null) continue
    if (entries.some((e) => e.name.startsWith(PLUGIN_PREFIX))) {
      return { base: cand, source: cand === override ? 'override' : 'auto', tried: tried }
    }
  }
  return { base: null, error: '无法定位插件根目录：候选中均未发现 ' + PLUGIN_PREFIX + '* 目录', tried: tried }
}

export async function scanRegistry(ctx, base) {
  const fs = ctx.get('fs')
  const roots = [{ where: 'home', path: base }, { where: 'devices', path: base + '/dsh-collab/devices' }]
  const found = []
  for (const root of roots) {
    const dirs = await listDirNames(fs, root.path)
    if (dirs === null) {
      found.push({ where: root.where, path: root.path, available: false, entries: [] })
      continue
    }
    const entries = dirs.filter((name) => name.startsWith(PLUGIN_PREFIX)).map((name) => ({
      where: root.where, path: root.path + '/' + name, dirName: name, slug: name.slice(PLUGIN_PREFIX.length),
    }))
    found.push({ where: root.where, path: root.path, available: true, entries: entries })
  }
  return found
}

export async function collect(fs, dirPath) {
  const pkgRaw = await readFileAt(fs, dirPath + '/package.json')
  let pkg = null
  let pkgError = null
  if (pkgRaw === null) pkgError = 'package.json 缺失'
  else {
    try {
      pkg = JSON.parse(pkgRaw)
    } catch (err) {
      pkgError = 'package.json 解析失败: ' + String((err && err.message) || err)
    }
  }
  const patch = await readFileAt(fs, dirPath + '/cordis.patch.yml')
  const cli = await readFileAt(fs, dirPath + '/cli.js')
  const selfcheck = await readFileAt(fs, dirPath + '/lib/selfcheck.js')
  const gate = await readFileAt(fs, dirPath + '/lib/gate.js')
  const core = await readFileAt(fs, dirPath + '/lib/core.js')
  const readme = (await readFileAt(fs, dirPath + '/docs/README.md')) || (await readFileAt(fs, dirPath + '/README.md'))
  const changelog = await readFileAt(fs, dirPath + '/CHANGELOG.md')
  const client = await readFileAt(fs, dirPath + '/lib/client.js')
  const entries = await listEntriesOn(fs, dirPath)
  const mainRel = pkg && typeof pkg.main === 'string' ? pkg.main : 'lib/index.js'
  const mainSrc = await readFileAt(fs, dirPath + '/' + mainRel)
  return {
    pkgRaw: pkgRaw, pkg: pkg, pkgError: pkgError, patch: patch, cli: cli, selfcheck: selfcheck,
    gate: gate, core: core, readme: readme, changelog: changelog, client: client,
    entries: entries, mainRel: mainRel, mainSrc: mainSrc,
  }
}

// node 可执行文件解析：先问 subprocess.resolveExecutable，再退回候选绝对路径。
// 本机实测 host 的 bash PATH 里没有 node —— 这是环境问题，必须与包问题分开报。
export async function resolveNode(ctx, fs) {
  const subprocess = ctx.get('subprocess')
  if (subprocess && typeof subprocess.resolveExecutable === 'function') {
    try {
      const resolved = await subprocess.resolveExecutable('node')
      if (typeof resolved === 'string' && resolved.length > 0) {
        return { node: resolved, via: 'subprocess.resolveExecutable' }
      }
    } catch (err) {
      // 回退路径探针
    }
  }
  for (const cand of NODE_CANDIDATES) {
    const info = await statOf(fs, cand)
    if (info && info.type === 'file') return { node: cand, via: 'fs 路径探针' }
  }
  return { node: null, via: null }
}

// R006 ①-5 真挂载冒烟：真 import 入口 + 递归 any-stub 桩 ctx 调 apply + 断言注册结果。
// 四态如实分报：pass / fail / skipped / timeout —— 绝不假装通过。
export async function runSmoke(ctx, fs, dirPath, mainRel) {
  const shell = ctx.get('shell')
  if (shell === undefined || shell === null) {
    return { state: 'skipped', reason: 'shell 服务不可用，无法执行真挂载冒烟' }
  }
  const nodeInfo = await resolveNode(ctx, fs)
  if (nodeInfo.node === null) {
    return { state: 'skipped', reason: '环境缺 node（PATH 与 ' + NODE_CANDIDATES.length + ' 个候选路径均未命中）—— 环境问题，不是插件问题' }
  }
  const target = await tryResolve(fs, dirPath + '/' + mainRel)
  if (target === null) return { state: 'skipped', reason: '入口文件无法解析: ' + mainRel }
  let url = null
  try {
    url = fs.fileUrl(target)
  } catch (err) {
    return { state: 'skipped', reason: '无法生成 file: URL' }
  }
  const command = nodeInfo.node + ' --input-type=module -e ' + shellQuote(SMOKE_SCRIPT) + ' ' + shellQuote(url)
  const expected = nodeInfo.node + ' --input-type=module -e ' + shellQuote(SMOKE_SCRIPT) + ' ' + shellQuote(url)
  // ⑩ 出站门：命令必须逐字符等于冻结模板，唯一变量是 shell-quoted 的 file URL
  if (command !== expected) return { state: 'skipped', reason: '命令模板逐字符校验失败（拒绝执行）' }
  if (COMMAND_WHITELIST.indexOf('node') === -1 || !/\/node$/.test(command.split(' ')[0])) {
    return { state: 'skipped', reason: '出站命令不在白名单' }
  }
  try {
    const spec = shell.resolve({ command: command, workdir: dirPath, timeoutMs: 15000 })
    const result = await shell.run(spec)
    const stdout = result && result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : ''
    const stderr = result && result.stderr && typeof result.stderr.text === 'string' ? result.stderr.text : ''
    if (result && result.timedOut) {
      return { state: 'timeout', reason: 'apply() 15s 未返回：apply 阶段疑似阻塞（起服务/监听/网络等待）', node: nodeInfo.node, via: nodeInfo.via }
    }
    const matched = /SMOKE:(\{[\s\S]*\})/.exec(stdout)
    if (matched === null) {
      return { state: 'fail', reason: '探针未产出 SMOKE 标记', exitCode: result ? result.exitCode : null, stderrTail: tail(stderr, 400), node: nodeInfo.node, via: nodeInfo.via }
    }
    let parsed = null
    try {
      parsed = JSON.parse(matched[1])
    } catch (err) {
      return { state: 'fail', reason: 'SMOKE 标记不可解析', exitCode: result ? result.exitCode : null }
    }
    return {
      state: parsed.state,
      registered: Array.isArray(parsed.registered) ? parsed.registered : [],
      effects: typeof parsed.effects === 'number' ? parsed.effects : null,
      errors: Array.isArray(parsed.errors) ? parsed.errors.slice(0, 5) : [],
      reason: typeof parsed.reason === 'string' ? parsed.reason : null,
      exitCode: result ? result.exitCode : null,
      node: nodeInfo.node,
      via: nodeInfo.via,
      note: '桩 ctx 能力有限：桩缺能力导致的报错不等于真挂载失败，以真挂载为准',
    }
  } catch (err) {
    return { state: 'skipped', reason: 'shell 执行失败: ' + String((err && err.message) || err), node: nodeInfo.node }
  }
}
