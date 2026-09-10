/**
 * 产物导出（M9）：会话沙箱 generated/{java,react} → zip。
 * 逻辑层纯函数（可测）+ HTTP 层在 index.ts 直接调用。
 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { Workspace } from './workspace';

export type ExportTarget = 'java' | 'react' | 'all';

export function parseExportTarget(raw: string | undefined): ExportTarget | undefined {
  return raw === 'java' || raw === 'react' || raw === 'all' ? raw : undefined;
}

/** 打包产物：java/react 只含对应端；all 额外附带 tdsl/ 源码分片 */
export async function exportZip(ws: Workspace, target: ExportTarget): Promise<Buffer> {
  const zip = new JSZip();
  const addDir = (relDir: string, zipDir: string): void => {
    for (const f of ws.listFiles(relDir)) {
      zip.file(`${zipDir}/${f.rel.slice(relDir.length + 1)}`, readFileSync(f.abs));
    }
  };
  if (target === 'java' || target === 'all') addDir('generated/java', 'java');
  if (target === 'react' || target === 'all') addDir('generated/react', 'react');
  if (target === 'all') {
    for (const f of ws.listTdsl()) zip.file(`tdsl/${f.path}`, f.content);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
