/**
 * 输入解析（M8）：
 *   dir → 顶层 *.tdsl 按文件名排序（M7 分片形态）；file → 单元素。
 *   app 名：--name 指定，缺省取目录名清洗为合法 Java 标识符（codegen-java 校验是最后防线）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { TdslSourceFile } from '@tdsl/parser';

export interface TdslInput {
  /** 分片列表（M7 parseProject 输入） */
  files: TdslSourceFile[];
  /** 输入基准目录（相对输出路径的参照） */
  baseDir: string;
  /** 清洗后的 app 名 */
  appName: string;
  /** 原始目录名（人话提示用） */
  rawName: string;
}

export class CliError extends Error {
  constructor(message: string, public readonly code = 1) {
    super(message);
    this.name = 'CliError';
  }
}

/** 解析 dir|file → 分片列表 + app 名 */
export function resolveInput(target: string, nameFlag?: string): TdslInput {
  const abs = isAbsolute(target) ? target : resolve(target);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new CliError(`路径不存在: ${target}`);
  }

  let files: TdslSourceFile[];
  let baseDir: string;
  let rawName: string;
  if (st.isDirectory()) {
    baseDir = abs;
    rawName = basename(abs);
    files = readdirSync(abs)
      .filter((f) => f.endsWith('.tdsl'))
      .sort()
      .map((name) => ({ path: name, content: readFileSync(join(abs, name), 'utf8') }));
    if (files.length === 0) {
      throw new CliError(`目录 ${target} 下没有 .tdsl 文件`);
    }
  } else if (st.isFile()) {
    baseDir = dirname(abs);
    rawName = basename(abs).replace(/\.tdsl$/, '');
    files = [{ path: basename(abs), content: readFileSync(abs, 'utf8') }];
  } else {
    throw new CliError(`既不是目录也不是文件: ${target}`);
  }

  const appName = nameFlag ?? sanitizeAppName(rawName);
  return { files, baseDir, appName, rawName };
}

/** 目录名 → 合法 Java 标识符（codegen 包名 com.<name>）：去非法字符；非字母开头补 app 前缀；空则 app */
export function sanitizeAppName(raw: string): string {
  let name = raw.replace(/[^A-Za-z0-9_]/g, '');
  if (name === '') return 'app';
  if (!/^[A-Za-z]/.test(name)) name = 'app' + name;
  return name;
}
