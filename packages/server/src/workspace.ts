/**
 * 会话沙箱（M9）：每会话一个目录，pi cwd 绑定它。
 * 目录即状态：agent 用 write/read 工具操作 tdsl/ 分片，compile 工具天然作用整个目录。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/** 沙箱内的相对路径安全校验：只允许 tdsl/*.tdsl 与 examples/*.md，拒绝目录穿越 */
export function safeSandboxPath(root: string, rel: string, subdir: 'tdsl' | 'examples'): string {
  if (!rel.endsWith('.tdsl') && !rel.endsWith('.md')) {
    throw new Error(`非法文件类型（仅 .tdsl / .md）: ${rel}`);
  }
  const abs = resolve(join(root, rel));
  const base = resolve(root);
  if (!abs.startsWith(base + sep)) {
    throw new Error(`路径越界（拒绝 .. 穿越）: ${rel}`);
  }
  if (!abs.startsWith(resolve(join(base, subdir)) + sep)) {
    throw new Error(`只允许写入 ${subdir}/ 目录: ${rel}`);
  }
  return abs;
}

/** 相对路径归一化：裸文件名补子目录前缀；已带前缀则原样 */
function normalize(rel: string, subdir: 'tdsl' | 'examples'): string {
  return rel.startsWith(`${subdir}/`) ? rel : `${subdir}/${rel.replace(/^\/+/, '')}`;
}

export class Workspace {
  constructor(readonly root: string) {}

  ensure(): void {
    for (const d of ['tdsl', 'examples']) {
      const dir = join(this.root, d);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  /** 写入 tdsl/ 分片（裸文件名或 tdsl/ 前缀皆可，安全校验） */
  writeTdsl(rel: string, content: string): string {
    const abs = safeSandboxPath(this.root, normalize(rel, 'tdsl'), 'tdsl');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    return abs;
  }

  /** 写入 examples/ 示例文件（agent 按需读取的 Prompt Pack 资产） */
  writeExample(rel: string, content: string): string {
    const abs = safeSandboxPath(this.root, normalize(rel, 'examples'), 'examples');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    return abs;
  }

  readTdsl(rel: string): string {
    return readFileSync(safeSandboxPath(this.root, normalize(rel, 'tdsl'), 'tdsl'), 'utf8');
  }

  /** tdsl/ 下所有分片（文件名排序），空目录返回 [] */
  listTdsl(): Array<{ path: string; content: string }> {
    const dir = join(this.root, 'tdsl');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.tdsl'))
      .sort()
      .map((name) => ({ path: name, content: readFileSync(join(dir, name), 'utf8') }));
  }

  /** 批量写入 codegen 产物到 generated/<target>/（路径安全校验，拒绝 .. 穿越） */
  writeGenerated(target: 'java' | 'react', files: Array<{ path: string; content: string | Buffer }>): number {
    const base = resolve(join(this.root, 'generated', target));
    if (!base.startsWith(resolve(join(this.root, 'generated')) + sep)) {
      throw new Error(`非法产物目录: ${target}`);
    }
    for (const f of files) {
      const abs = resolve(base, f.path);
      if (!abs.startsWith(base + sep)) {
        throw new Error(`产物路径越界（拒绝 .. 穿越）: ${f.path}`);
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
    return files.length;
  }

  /** generated/<target>/ 是否已落盘（导出前置检查） */
  hasGenerated(target: 'java' | 'react'): boolean {
    return existsSync(join(this.root, 'generated', target));
  }

  /** 递归列出某目录下全部文件（相对 root 的 posix 风格路径），供打包导出 */
  listFiles(relDir: string): Array<{ rel: string; abs: string }> {
    const dir = join(this.root, relDir);
    if (!existsSync(dir)) return [];
    const out: Array<{ rel: string; abs: string }> = [];
    const walk = (cur: string): void => {
      for (const name of readdirSync(cur, { withFileTypes: true })) {
        const full = join(cur, name.name);
        if (name.isDirectory()) walk(full);
        else out.push({ rel: full.slice(this.root.length + 1).split(sep).join('/'), abs: full });
      }
    };
    walk(dir);
    return out;
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
