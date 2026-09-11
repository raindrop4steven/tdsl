/**
 * CLI 主入口（M8）：argv 分派 → lib 函数 → 打印 → 退出码。
 * 零新增依赖：argv 手写解析（4 命令、参数≤3 个）。
 */
import { runBuild, runBundleJar, runCheck, runGenerate, runParse, type CommandResult } from './commands';
import { CliError, resolveInput, sanitizeAppName } from './input';

export const HELP = `dsl — TDSL 命令行工具

用法: dsl <command> <dir|file> [options]

命令:
  parse      编译（parse+link）并打印摘要
  check      parse + typecheck，打印诊断（有 error 退出码 1）
  generate   生成 Java/React 代码并写盘
  build      generate + mvn compile + vite build（双端真实构建）
  bundle-jar <jar> -o <json>  将 Java jar 并入 FFI 目录（离线；javap 反射）
  help       命令帮助

选项:
  -o <dir>      输出目录（generate/build，默认 ./generated）
  --java        generate 仅生成 Java
  --react       generate 仅生成 React
  --name <x>    app 名（默认取目录名，清洗为合法 Java 标识符）
  --json        parse 输出完整 AST JSON`;

export interface CliResult extends CommandResult {}

/** 可编程入口：argv → 结果（bin 打印；测试直接断言） */
export function run(argv: string[]): CliResult {
  const [cmd, target, ...rest] = argv;
  try {
    if (!cmd || cmd === 'help') {
      return { code: 0, stdout: HELP };
    }
    if (!target) {
      throw new CliError(`缺少输入参数: dsl ${cmd} <dir|file>\n${HELP}`);
    }

    const { json, out, targets, name } = parseFlags(cmd, rest);

    // bundle-jar 特殊输入：target = jar 文件（不走 tdsl 输入解析）
    if (cmd === 'bundle-jar') {
      return runBundleJar(target, out);
    }

    const input = resolveInput(target, name);

    switch (cmd) {
      case 'parse':
        return runParse(input, json);
      case 'check':
        return runCheck(input);
      case 'generate':
        return runGenerate(input, out, targets);
      case 'build':
        return runBuild(input, out);
      default:
        throw new CliError(`未知命令: ${cmd}\n${HELP}`);
    }
  } catch (e) {
    if (e instanceof CliError) {
      return { code: e.code, stdout: e.message };
    }
    throw e;
  }
}

interface Flags {
  json: boolean;
  out: string;
  targets: { java: boolean; react: boolean };
  name?: string;
}

function parseFlags(cmd: string, rest: string[]): Flags {
  const flags: Flags = {
    json: false,
    out: 'generated',
    targets: { java: true, react: true },
    name: undefined,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') flags.json = true;
    else if (a === '-o') flags.out = requireValue(rest, ++i, a);
    else if (a === '--java') {
      if (cmd !== 'generate') throw new CliError('--java 仅 generate 命令支持');
      flags.targets = { java: true, react: false };
    } else if (a === '--react') {
      if (cmd !== 'generate') throw new CliError('--react 仅 generate 命令支持');
      flags.targets = { java: false, react: true };
    } else if (a === '--name') {
      // --name 也过一遍清洗（与缺省名同一规则，防御性一致）
      flags.name = sanitizeAppName(requireValue(rest, ++i, a));
    } else throw new CliError(`未知选项: ${a}`);
  }
  return flags;
}

function requireValue(rest: string[], i: number, flag: string): string {
  if (i >= rest.length) throw new CliError(`选项 ${flag} 缺少值`);
  return rest[i];
}

/** bin 入口：打印 + 退出码 */
export function main(argv: string[]): void {
  const { code, stdout } = run(argv);
  if (stdout) console.log(stdout);
  process.exitCode = code;
}
