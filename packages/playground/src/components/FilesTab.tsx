import { useMemo, useState } from 'react';
import type { GeneratedFile } from '@tdsl/core';
import { useI18n } from '../i18n';

interface Props {
  files: GeneratedFile[];
  emptyHint: string;
}

/** 生成产物面板：文件树 + 点击预览 + 复制（Java/React 共用） */
export function FilesTab({ files, emptyHint }: Props) {
  const { t } = useI18n();
  const tree = useMemo(() => buildTree(files), [files]);
  const [selected, setSelected] = useState<GeneratedFile | null>(null);
  const [copied, setCopied] = useState(false);

  if (files.length === 0) {
    return <div className="tab-body muted">{emptyHint}</div>;
  }

  const current = selected && files.some((f) => f.path === selected.path) ? selected : null;

  return (
    <div className="files-layout">
      <div className="file-tree">
        {tree.map((dir) => (
          <div key={dir.dir}>
            <div className="dir-label">📁 {dir.dir || t.files.root}</div>
            {dir.files.map((f) => (
              <div
                key={f.path}
                className={`file-item ${current?.path === f.path ? 'selected' : ''}`}
                onClick={() => {
                  setSelected(f);
                  setCopied(false);
                }}
              >
                📄 {f.path.split('/').pop()}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="file-preview">
        {current ? (
          <>
            <div className="preview-head">
              <span className="preview-path">{current.path}</span>
              <button
                className="copy-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(current.content).then(() => setCopied(true));
                }}
              >
                {copied ? t.files.copied : t.files.copy}
              </button>
            </div>
            <pre className="preview-code">{current.content}</pre>
          </>
        ) : (
          <div className="tab-body muted">{t.files.pickHint}</div>
        )}
      </div>
    </div>
  );
}

interface DirGroup {
  dir: string;
  files: GeneratedFile[];
}

/** 按目录分组（保持生成顺序，稳定展示） */
function buildTree(files: GeneratedFile[]): DirGroup[] {
  const groups = new Map<string, GeneratedFile[]>();
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    const list = groups.get(dir) ?? [];
    list.push(f);
    groups.set(dir, list);
  }
  return [...groups.entries()].map(([dir, fs]) => ({ dir, files: fs }));
}
