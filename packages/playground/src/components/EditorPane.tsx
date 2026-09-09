import { useEffect, useRef } from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { ParseErrorInfo } from '../pipeline';

interface Props {
  value: string;
  onChange: (v: string) => void;
  parseError?: ParseErrorInfo;
}

/** 左侧编辑器：TDSL 高亮 + parse 错误行列标红 */
export function EditorPane({ value, onChange, parseError }: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (parseError && !parseError.linkStage) {
      monaco.editor.setModelMarkers(model, 'tdsl', [
        {
          startLineNumber: parseError.line,
          startColumn: parseError.col,
          endLineNumber: parseError.line,
          endColumn: parseError.col + 1,
          message: parseError.message,
          severity: monaco.MarkerSeverity.Error,
        },
      ]);
    } else {
      monaco.editor.setModelMarkers(model, 'tdsl', []);
    }
  }, [parseError]);

  return (
    <Editor
      language="tdsl"
      theme="tdsl-dark"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={onMount}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
      }}
    />
  );
}
