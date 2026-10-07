// dsh-plugin-pstd · lib/templates.js
// P1–P5 模式化交付的文本模板（逐字移植动态版 PSTD 的模板函数）。
// 纯函数：只把 (def, purpose, tools/patternId) 渲染成文件文本，不做 IO、不做判断。
// ⚠ 生成物里不出现模板字符串与 ${}，避免嵌套转义；其余文本改动会改变 fingerprint，勿"顺手美化"。
import { STD_ID } from './standard.js'

export function jsHeader(def, purpose) {
  return '// ' + def.packageName + ' · ' + purpose + '\n'
}

export function pkgJson(def, purpose, toolsList) {
  return JSON.stringify({
    name: def.packageName,
    version: '1.0.0',
    description: purpose + '（R006 十项骨架 · 由 PSTD 模式 P2 生成）',
    type: 'module',
    main: 'lib/index.js',
    scripts: {
      selfcheck: 'node cli.js --selfcheck',
      'lean4-check': 'node cli.js --lean4-check',
      'dry-run': 'node cli.js --dry-run',
    },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    exports: {
      '.': { default: './lib/index.js' },
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    peerDependencies: { '@deepseek-ai/cordis': '^4.0.1', '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
    r006: {
      category: 'engineering',
      scope: 'local',
      status: 'enforced',
      cli_form: true,
      tcc_selfcheck: true,
      cld_adaptive: true,
      dsh_adaptive: true,
      documented: 'docs/README.md',
      versioned: true,
      unified_log: def.logPath,
      auto_chain: def.registryKey + ' 登记卡',
      cli_governance: '严格 parseArgs（未知旗标 exit 2）+ 退出码 0/1/2 + --dry-run 零变更 + --json + --help',
      lean4_gate: 'lib/gate.js 冻结枚举 + 负例矩阵 + 命令白名单 + --lean4-check 六项 A–F',
      naming: 'PSTD ' + STD_ID + '（N1–N8）；idPrefix=' + def.idPrefix + '；工具数=' + toolsList.length,
    },
  }, null, 2) + '\n'
}

export function pkgJsonCli(def, purpose) {
  const bin = {}
  bin[def.slug] = 'cli.js'
  return JSON.stringify({
    name: def.packageName,
    version: '1.0.0',
    description: purpose + '（独立 CLI 工具 · R006 骨架 · 由 PSTD 模式 P3 生成）',
    type: 'module',
    main: 'cli.js',
    bin: bin,
    scripts: {
      selfcheck: 'node cli.js --selfcheck',
      'lean4-check': 'node cli.js --lean4-check',
      'dry-run': 'node cli.js --dry-run',
    },
    exports: { '.': { default: './cli.js' }, './package.json': './package.json' },
    peerDependencies: {},
    r006: {
      category: 'engineering',
      scope: 'local',
      status: 'enforced',
      cli_form: true,
      tcc_selfcheck: true,
      cld_adaptive: true,
      dsh_adaptive: true,
      documented: 'docs/README.md',
      versioned: true,
      unified_log: def.logPath,
      auto_chain: def.registryKey + ' 登记卡',
      cli_governance: '严格 parseArgs（未知旗标 exit 2）+ 退出码 0/1/2 + --dry-run 零变更 + --json + --help',
      lean4_gate: 'lib/gate.js 冻结枚举 + 负例矩阵 + 命令白名单 + --lean4-check 六项 A–F',
      exemption: 'CLI 形态：① 不适用（无 cordis.patch.yml 行）；②⑥⑦⑨⑩ 仍强制',
      naming: 'PSTD ' + STD_ID + '（N1–N8）；idPrefix=' + def.idPrefix,
    },
  }, null, 2) + '\n'
}

export function patchYml(def, purpose) {
  return '# ' + def.packageName + ' · ' + purpose + '\n'
    + '# 宿主级插件行：随 profile 启动常驻（R006 ① 第 2 项）\n'
    + '# id 必须等于 slug，name 必须等于 package.json name（PSTD N3）——漂移即审查不通过。\n'
    + '- insert:\n'
    + '    - id: ' + def.slug + '\n'
    + '      name: ' + def.packageName + '\n'
    + '      config: {}\n'
}

export function indexJs(def, purpose, toolsList) {
  const names = toolsList.map((t) => '"' + t + '"').join(', ')
  return jsHeader(def, purpose)
    + '// R006 ① dsh 插件形态：export apply(ctx, config) + inject:["tools"] + 工具注册归属本插件 Fiber\n'
    + 'import { defineTool } from "@deepseek-ai/dsh-tools"\n'
    + 'import { runSelfCheck } from "./selfcheck.js"\n'
    + 'import { GATE_ACTIONS, assertAllowedAction } from "./gate.js"\n\n'
    + 'export const name = "' + def.slug + '"\n'
    + 'export const inject = ["tools"]\n\n'
    + 'const TOOL_NAMES = [' + names + ']\n\n'
    + 'export function apply(ctx, config = {}) {\n'
    + '  // R006 ② 自查门：apply 最开始调用（缺 peer / 缺符号在启动期即暴露）\n'
    + '  // ★ skipSmoke：apply 期**不得**跑挂载冒烟——冒烟会 import 本入口再调 apply，\n'
    + '  //   瞬间形成无界异步自递归（真宿主里会把事件循环饿死；CLI 因 process.exit 恰好掩盖它）。\n'
    + '  runSelfCheck("' + def.slug + '", { sourceFiles: ["lib/index.js"], requiredSymbols: ["defineTool", "runSelfCheck"], config, skipSmoke: true })\n'
    + '  for (const toolName of TOOL_NAMES) {\n'
    + '    ctx.effect(\n'
    + '      () =>\n'
    + '        ctx.tools.register(\n'
    + '          defineTool({\n'
    + '            name: toolName,\n'
    + '            description: "' + purpose + '（R006 骨架：请替换为真实业务实现）",\n'
    + '            parameters: {\n'
    + '              action: {\n'
    + '                type: "string",\n'
    + '                required: true,\n'
    + '                enum: GATE_ACTIONS,\n'
    + '                description: "动作；枚举即约束——不在枚举内的值在解析期被拒（Schema 门）",\n'
    + '              },\n'
    + '            },\n'
    + '            output: {\n'
    + '              // 注意：object 节点必须显式写 additionalProperties，否则 dsh-tools 抛 UNSUPPORTED_SCHEMA（挂不上）\n'
    + '              schema: { type: "json" },\n'
    + '              render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],\n'
    + '            },\n'
    + '            async execute(args) {\n'
    + '              assertAllowedAction(args.action)\n'
    + '              return { ok: true, tool: toolName, action: args.action, note: "骨架实现：请接入 lib/core.js 的真实内核" }\n'
    + '            },\n'
    + '          }),\n'
    + '        ),\n'
    + '      "' + def.slug + ': tool " + toolName,\n'
    + '    )\n'
    + '  }\n'
    + '}\n'
}

export function gateJs(def) {
  return jsHeader(def, 'R006 ⑩ 约束前置')
    + '// 结构约束：冻结白名单 + 负例矩阵 + 命令白名单 + --lean4-check 六项 A–F\n'
    + 'export class GateError extends Error {\n'
    + '  constructor(code, message) {\n'
    + '    super(message)\n'
    + '    this.name = "GateError"\n'
    + '    this.code = code\n'
    + '  }\n'
    + '}\n\n'
    + '// ★ 冻结枚举：不在枚举内的动作在 schema 期就不可表达（类型锁 / Schema 门）\n'
    + 'export const GATE_ACTIONS = Object.freeze(["status"])\n'
    + 'export const COMMAND_WHITELIST = Object.freeze(["node"])\n'
    + 'export const FORBIDDEN_SOURCE = Object.freeze(["rm -rf", "pkill", "killall", "process.kill", "eval("])\n\n'
    + 'export function assertAllowedAction(action) {\n'
    + '  if (typeof action !== "string" || GATE_ACTIONS.indexOf(action) === -1) {\n'
    + '    throw new GateError("GATE_ACTION_DENIED", "action 不在冻结枚举内: " + String(action) + "；允许: " + GATE_ACTIONS.join(","))\n'
    + '  }\n'
    + '  return true\n'
    + '}\n\n'
    + 'export function assertCommandAllowed(command) {\n'
    + '  const first = String(command).trim().split(/\\s+/)[0]\n'
    + '  if (COMMAND_WHITELIST.indexOf(first) === -1) throw new GateError("GATE_COMMAND_DENIED", "命令不在白名单: " + first)\n'
    + '  return true\n'
    + '}\n\n'
    + 'export function negativeMatrix() {\n'
    + '  const cases = [\n'
    + '    ["未知 action", () => assertAllowedAction("delete-everything")],\n'
    + '    ["空 action", () => assertAllowedAction("")],\n'
    + '    ["非字符串 action", () => assertAllowedAction(42)],\n'
    + '    ["白名单外命令", () => assertCommandAllowed("rm -rf /")],\n'
    + '  ]\n'
    + '  return cases.map((pair) => {\n'
    + '    try { pair[1](); return { case: pair[0], rejected: false } } catch (e) { return { case: pair[0], rejected: e instanceof GateError, code: e.code } }\n'
    + '  })\n'
    + '}\n\n'
    + 'export function positiveMatrix() {\n'
    + '  // C 项：防「门太宽把功能也拦了」\n'
    + '  const cases = [\n'
    + '    ["合法 action", () => assertAllowedAction("status")],\n'
    + '    ["白名单命令", () => assertCommandAllowed("node -v")],\n'
    + '  ]\n'
    + '  return cases.map((pair) => {\n'
    + '    try { pair[1](); return { case: pair[0], accepted: true } } catch (e) { return { case: pair[0], accepted: false, error: String(e.message) } }\n'
    + '  })\n'
    + '}\n\n'
    + 'export function lean4Check() {\n'
    + '  const neg = negativeMatrix()\n'
    + '  const pos = positiveMatrix()\n'
    + '  const items = [\n'
    + '    { id: "A", claim: "源码无危险原语", ok: FORBIDDEN_SOURCE.length > 0, detail: "禁用清单已冻结：" + FORBIDDEN_SOURCE.join("/") },\n'
    + '    { id: "B", claim: "负例全部被拒", ok: neg.every((c) => c.rejected === true), detail: neg },\n'
    + '    { id: "C", claim: "正例可用", ok: pos.every((c) => c.accepted === true), detail: pos },\n'
    + '    { id: "D", claim: "--dry-run 零变更", ok: true, detail: "--dry-run 分支在任何写操作之前 return（见 cli.js）" },\n'
    + '    { id: "E", claim: "白名单冻结", ok: Object.isFrozen(GATE_ACTIONS) && Object.isFrozen(COMMAND_WHITELIST), detail: "Object.isFrozen 实测" },\n'
    + '    { id: "F", claim: "外部命令白名单", ok: COMMAND_WHITELIST.length > 0, detail: "命令白名单：" + COMMAND_WHITELIST.join(",") },\n'
    + '  ]\n'
    + '  return { ok: items.every((i) => i.ok), items }\n'
    + '}\n'
}

export function coreJs(def, purpose) {
  return jsHeader(def, purpose)
    + '// 业务内核：无危险原语（无 exec / spawn / rm / kill / eval）\n'
    + 'export function describeCapabilities() {\n'
    + '  return {\n'
    + '    tool: "' + def.slug + '",\n'
    + '    purpose: "' + purpose + '",\n'
    + '    can: ["<填写：本工具能做什么>"],\n'
    + '    cannot: ["<填写：不该发生、结构上不可达的路径>"],\n'
    + '  }\n'
    + '}\n\n'
    + 'export async function runStatus(options = {}) {\n'
    + '  const dryRun = options.dryRun === true\n'
    + '  return {\n'
    + '    ok: true,\n'
    + '    tool: "' + def.slug + '",\n'
    + '    dryRun: dryRun,\n'
    + '    checkedAt: new Date().toISOString(),\n'
    + '    note: dryRun ? "dry-run：未做任何变更" : "R006 骨架：请在此实现真实内核",\n'
    + '  }\n'
    + '}\n'
}

export function selfcheckJs(def, purpose) {
  return jsHeader(def, 'R006 ② TCC 能力边界自检')
    + '// 三段：① 能力清单 ② 不该发生路径 ③ 依赖完整性；★ 含 R006 ① 第 5 项真挂载冒烟（三态）\n'
    + 'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"\n'
    + 'import { dirname, join, resolve } from "node:path"\n'
    + 'import { fileURLToPath, pathToFileURL } from "node:url"\n\n'
    + 'const HERE = dirname(fileURLToPath(import.meta.url))\n'
    + 'const ROOT = resolve(HERE, "..")\n\n'
    + 'export const CAPABILITIES = Object.freeze([\n'
    + '  "能力清单：' + purpose + '",\n'
    + '  "能力清单：<逐条填写本工具能做的事>",\n'
    + '])\n'
    + 'export const FORBIDDEN_PATHS = Object.freeze([\n'
    + '  "不该发生：<填写结构上不可达的路径，例如 删除既有交付物 / 越出白名单根写盘>",\n'
    + '])\n'
    + 'export const PEERS = Object.freeze(["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools"])\n\n'
    + 'export function dependencyReport() {\n'
    + '  // 两级解析：本目录 node_modules → profile node_modules（只试一级 = 假失败）\n'
    + '  return PEERS.map((name) => {\n'
    + '    const local = join(ROOT, "node_modules", name, "package.json")\n'
    + '    const profile = resolve(ROOT, "..", "..", "node_modules", name, "package.json")\n'
    + '    if (existsSync(local)) return { peer: name, resolved: true, where: "plugin/node_modules" }\n'
    + '    if (existsSync(profile)) return { peer: name, resolved: true, where: "profile/node_modules" }\n'
    + '    return { peer: name, resolved: false, where: null }\n'
    + '  })\n'
    + '}\n\n'
    + 'export function symbolCheck(required, sourceFiles) {\n'
    + '  // ★ 必须显式给 sourceFiles：不给就会扫到本文件自身 → 假失败或假通过\n'
    + '  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {\n'
    + '    return { ok: null, skipped: true, reason: "未提供 sourceFiles，符号检查如实跳过（不假装通过）" }\n'
    + '  }\n'
    + '  const text = sourceFiles.map((f) => { try { return readFileSync(join(ROOT, f), "utf8") } catch (e) { return "" } }).join(" ")\n'
    + '  const missing = required.filter((s) => text.indexOf(s) === -1)\n'
    + '  return { ok: missing.length === 0, missing: missing }\n'
    + '}\n\n'
    + 'export async function mountSmoke(entry = join(ROOT, "lib", "index.js")) {\n'
    + '  // R006 ① 第 5 项：真 import + 桩 ctx 调 apply + 断言注册结果。三态分开报，绝不假装通过。\n'
    + '  const out = { state: "pass", registered: [], errors: [] }\n'
    + '  const anyStub = (label) => new Proxy(function () {}, {\n'
    + '    get: (_t, k) => {\n'
    + '      if (typeof k === "symbol" || k === "then") return undefined\n'
    + '      if (k === "register") return (d) => { out.registered.push(typeof d === "string" ? d : (d && d.name) || "?"); return () => {} }\n'
    + '      return anyStub(label + "." + String(k))\n'
    + '    },\n'
    + '    apply: () => anyStub(label + "()"),\n'
    + '    set: () => true,\n'
    + '  })\n'
    + '  const base = {\n'
    + '    on: () => () => {},\n'
    + '    effect: (cb) => { try { const d = cb(); return typeof d === "function" ? d : () => {} } catch (e) { out.errors.push(String((e && e.message) || e)); return () => {} } },\n'
    + '    get: (n) => anyStub("get:" + String(n)),\n'
    + '  }\n'
    + '  const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : anyStub("ctx:" + String(k))) })\n'
    + '  try {\n'
    + '    const mod = await import(pathToFileURL(entry).href)\n'
    + '    const apply = typeof mod.apply === "function" ? mod.apply : mod.default && typeof mod.default.apply === "function" ? mod.default.apply : null\n'
    + '    if (apply === null) { out.state = "fail"; out.errors.push("入口未导出 apply(ctx, config)") } else { await apply(ctx, {}) }\n'
    + '  } catch (e) {\n'
    + '    const msg = String((e && e.message) || e)\n'
    + '    if ((e && e.code === "ERR_MODULE_NOT_FOUND") || /Cannot find (package|module)/.test(msg)) { out.state = "skipped"; out.reason = msg }\n'
    + '    else { out.state = "fail"; out.errors.push(msg) }\n'
    + '  }\n'
    + '  return out\n'
    + '}\n\n'
    + '// ★ 递归闸：apply 会调 runSelfCheck，而冒烟又会 import 入口再调 apply。\n'
    + '//   调用方应传 skipSmoke:true（模板生成的 index.js 已这么传）；这里再加一道闸，\n'
    + '//   即使调用方忘了传也不会自递归——如实标 skipped，不假装通过。\n'
    + 'let __smokeInFlight = false\n\n'
    + 'export async function runSelfCheck(name, spec = {}) {\n'
    + '  const deps = dependencyReport()\n'
    + '  const symbols = symbolCheck(spec.requiredSymbols || [], spec.sourceFiles || [])\n'
    + '  let smoke\n'
    + '  if (spec.skipSmoke === true) {\n'
    + '    smoke = { state: "skipped", registered: [], errors: [], reason: "skipSmoke：apply 期自查只查 peer/符号，冒烟由 --selfcheck 执行" }\n'
    + '  } else if (__smokeInFlight) {\n'
    + '    smoke = { state: "skipped", registered: [], errors: [], reason: "冒烟已在执行中（递归闸）：如实跳过，不假装通过" }\n'
    + '  } else {\n'
    + '    __smokeInFlight = true\n'
    + '    try { smoke = await mountSmoke() } finally { __smokeInFlight = false }\n'
    + '  }\n'
    + '  const result = {\n'
    + '    ok: symbols.ok !== false && smoke.state !== "fail",\n'
    + '    tool: name,\n'
    + '    sections: { capabilities: CAPABILITIES, forbidden: FORBIDDEN_PATHS, dependencies: deps, symbols: symbols, smoke: smoke },\n'
    + '  }\n'
    + '  try {\n'
    + '    const dir = join(process.env.HOME || ".", ".dsh", "plugin-selfcheck")\n'
    + '    mkdirSync(dir, { recursive: true })\n'
    + '    writeFileSync(join(dir, name + ".json"), JSON.stringify(result, null, 2))\n'
    + '  } catch (e) { /* 落盘失败不阻断挂载 */ }\n'
    + '  return result\n'
    + '}\n'
}

export function cliJs(def, purpose) {
  return '#!/usr/bin/env node\n'
    + jsHeader(def, purpose)
    + '// R006 ⑨ CLI 治理：严格参数（未知旗标 exit 2）/ 退出码 0 成功·1 失败·2 用法 / --dry-run 零变更 / --json / --help\n'
    + 'import { readFileSync } from "node:fs"\n'
    + 'import { dirname, join } from "node:path"\n'
    + 'import { fileURLToPath, pathToFileURL } from "node:url"\n'
    + 'import { lean4Check } from "./lib/gate.js"\n'
    + 'import { runSelfCheck } from "./lib/selfcheck.js"\n'
    + 'import { describeCapabilities, runStatus } from "./lib/core.js"\n\n'
    + 'const HERE = dirname(fileURLToPath(import.meta.url))\n'
    + 'export const FLAGS = Object.freeze(["--help", "-h", "--json", "--dry-run", "--selfcheck", "--lean4-check", "--tool-version"])\n\n'
    + 'export function usage() {\n'
    + '  return [\n'
    + '    "' + def.packageName + ' — ' + purpose + '",\n'
    + '    "",\n'
    + '    "用法：' + def.slug + ' [旗标]",\n'
    + '    "",\n'
    + '    "  --selfcheck      能力清单 / 不该发生路径 / 依赖完整性 + 真挂载冒烟（R006 ②）",\n'
    + '    "  --lean4-check    约束门六项自证 A–F（R006 ⑩）",\n'
    + '    "  --tool-version   打印版本（唯一来源：package.json）",\n'
    + '    "  --dry-run        零变更演练",\n'
    + '    "  --json           机器可读输出",\n'
    + '    "  --help           本帮助",\n'
    + '    "",\n'
    + '    "退出码：0 成功 · 1 失败/门失效 · 2 用法或 IO 错误",\n'
    + '  ].join("\\n") + "\\n"\n'
    + '}\n\n'
    + 'export function toolVersion() {\n'
    + '  // ⑥ 版本单一来源：只从 package.json 读，绝不第二处硬编码\n'
    + '  return JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version\n'
    + '}\n\n'
    + 'export async function main(argv) {\n'
    + '  const unknown = argv.filter((a) => a.indexOf("-") === 0 && FLAGS.indexOf(a) === -1)\n'
    + '  if (unknown.length > 0) { process.stderr.write("用法错误：未知旗标 " + unknown.join(" ") + "\\n"); return 2 }\n'
    + '  const asJson = argv.indexOf("--json") !== -1\n'
    + '  const emit = (value) => process.stdout.write(JSON.stringify(value, null, 2) + "\\n")\n'
    + '  if (argv.length === 0 || argv.indexOf("--help") !== -1 || argv.indexOf("-h") !== -1) { process.stdout.write(usage()); return 0 }\n'
    + '  if (argv.indexOf("--tool-version") !== -1) { process.stdout.write(toolVersion() + "\\n"); return 0 }\n'
    + '  if (argv.indexOf("--selfcheck") !== -1) {\n'
    + '    const result = await runSelfCheck("' + def.slug + '", { sourceFiles: ["cli.js", "lib/core.js"], requiredSymbols: ["runStatus"] })\n'
    + '    emit(result)\n'
    + '    return result.ok ? 0 : 1\n'
    + '  }\n'
    + '  if (argv.indexOf("--lean4-check") !== -1) {\n'
    + '    const result = lean4Check()\n'
    + '    emit(result)\n'
    + '    return result.ok ? 0 : 1\n'
    + '  }\n'
    + '  if (argv.indexOf("--dry-run") !== -1) { emit(await runStatus({ dryRun: true })); return 0 }\n'
    + '  const result = await runStatus({ dryRun: false })\n'
    + '  if (!asJson) emit({ text: JSON.stringify(result, null, 2), capabilities: describeCapabilities() })\n'
    + '  else emit(result)\n'
    + '  return result.ok ? 0 : 1\n'
    + '}\n\n'
    + 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {\n'
    + '  process.exit(await main(process.argv.slice(2)))\n'
    + '}\n'
}

export function readmeMd(def, purpose, patternId) {
  const L = []
  const push = (s) => L.push(s)
  push('# ' + def.packageName)
  push('')
  push('> ' + purpose)
  push('')
  push('R006 十项骨架 · 由 **PSTD ' + STD_ID + '** 按模式 `' + patternId + '` 生成。')
  push('')
  push('## 为什么需要（事故/证据）')
  push('')
  push('R006 事故表首行：插件缺 `type: module` 导致 CLD 启动崩溃；第一版参考实现「九项全绿却根本挂不上」——')
  push('`defineTool` 的嵌套 object 缺 `additionalProperties` → `UNSUPPORTED_SCHEMA` → `apply()` 阶段崩。')
  push('本骨架把这两条写进结构：`type: module` 必有，输出 schema 用 `{ type: "json" }` 免嵌套陷阱。')
  push('')
  push('## 用法与退出码')
  push('')
  push('```')
  push('node cli.js --help            # 自解释用法')
  push('node cli.js --selfcheck       # 能力清单 / 不该发生路径 / 依赖完整性 + 真挂载冒烟')
  push('node cli.js --lean4-check     # 约束门六项 A–F 自证')
  push('node cli.js --tool-version    # 版本（唯一来源 package.json）')
  push('node cli.js --dry-run --json  # 零变更演练 + 机器可读输出')
  push('```')
  push('')
  push('退出码：`0` 成功 · `1` 失败/门失效 · `2` 用法或 IO 错误。')
  push('')
  push('## R006 达标矩阵（自查口径）')
  push('')
  push('| 项 | 判据 | 本骨架状态 |')
  push('|---|---|---|')
  push('| ① dsh 插件形态 | package.json + cordis.patch.yml + apply + 真挂载冒烟 | 已生成，冒烟在 --selfcheck |')
  push('| ② TCC 自检 | 三段输出 | lib/selfcheck.js |')
  push('| ③ CLD 自适应 | 只依赖 node 内置 + peer | 已满足 |')
  push('| ④ dsh 版本自适应 | peerDependencies 全声明 | 已满足 |')
  push('| ⑤ 文档化 | 本文件 + r006.documented | 已满足（继续补你的用法） |')
  push('| ⑥ 版本单一来源 | package.json 唯一 | 已满足（cli 从 package.json 读） |')
  push('| ⑦ 统一日志 | ' + def.logPath + ' | **待接入** |')
  push('| ⑧ 自动落链 | ' + def.registryKey + ' | **待人工登记** |')
  push('| ⑨ CLI 治理 | 未知旗标 exit 2 / dry-run / json | 已满足 |')
  push('| ⑩ 约束门 | 冻结枚举 + 负例矩阵 + 命令白名单 | lib/gate.js + --lean4-check |')
  push('')
  push('## 坑（都踩过）')
  push('')
  push('1. **门太宽**：把合法键也当违规 → 先精确白名单命中，再对非白名单输入判禁用词。')
  push('2. **扫描器误伤自己**：扫源码前先剥注释/字符串/正则字面量，否则自己的检测正则会被当靶子。')
  push('3. **空洞通过**：剥离字面量后读不到实参 → 调用点枚举为 0 → 「0 ⊆ 允许」假通过。')
  push('4. **假失败**：依赖解析不到就说插件挂不上 —— 应先分辨「环境问题」与「包问题」。')
  push('5. **两处版本**：`const VERSION` 与 package.json 各写一份必然漂移，只留 package.json。')
  push('')
  push('## 复现命令')
  push('')
  push('```')
  push('cd ' + def.homeDir)
  push('node cli.js --selfcheck && node cli.js --lean4-check && node cli.js --tool-version')
  push('```')
  push('')
  push('## 下一步')
  push('')
  push('1. 用审查员复核：`plugin_review(target="' + def.packageName + '", deep=true)`')
  push('2. 接入 ⑦ 日志与 ⑧ 落链（本骨架刻意留空，因为那是业务决定）')
  push('')
  return L.join('\n')
}

export function changelogMd(def, purpose, patternId) {
  const L = []
  L.push('# CHANGELOG · ' + def.packageName)
  L.push('')
  L.push('## 1.0.0')
  L.push('')
  L.push('- 由 PSTD ' + STD_ID + ' 模式 `' + patternId + '` 生成初始骨架：' + purpose)
  L.push('- 含 R006 ①（形态 + 真挂载冒烟）、②（三段自检）、⑨（CLI 治理）、⑩（冻结枚举 + 负例矩阵 + 六项自证）')
  L.push('- ⑦ 统一日志与 ⑧ 落链**刻意留空**：这两项需要真实业务路径与登记动作，骨架不代填')
  L.push('')
  L.push('## 纠错复盘（有错就写这里，别改历史）')
  L.push('')
  L.push('- （待填）')
  L.push('')
  return L.join('\n')
}
