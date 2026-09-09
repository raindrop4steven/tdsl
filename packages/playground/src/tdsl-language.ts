/**
 * Monaco 本地化 + TDSL 语言定义（离线可演示，不依赖 CDN）。
 * 只注册 editor worker（基础编辑），不用 TS/JSON 语言服务——TDSL 不是 TS，
 * 自带 monarch 高亮器即可，且避免 TS 语言服务对 TDSL 报无意义的红色波浪线。
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

export function setupMonaco(): void {
  // worker 全部走本地打包（离线安全）
  (self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
    getWorker: () => new editorWorker(),
  };
  loader.config({ monaco });
  registerTdslLanguage();
}

const KEYWORDS = [
  'entity', 'struct', 'enum', 'logic', 'interface', 'page', 'service', 'component',
  'if', 'else', 'for', 'in', 'return', 'new', 'true', 'false', 'null',
  'asc', 'desc', 'like', 'GET', 'POST', 'PUT', 'DELETE',
];

const BUILTIN_TYPES = ['Integer', 'Decimal', 'String', 'Boolean', 'Date', 'Time', 'DateTime', 'List', 'Map', 'Page'];

/** TDSL monarch 高亮：注解/关键字/内置类型/字符串/数字/注释/运算符 */
function registerTdslLanguage(): void {
  monaco.languages.register({ id: 'tdsl' });
  monaco.languages.setMonarchTokensProvider('tdsl', {
    keywords: KEYWORDS,
    builtinTypes: BUILTIN_TYPES,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/@[a-zA-Z_]\w*/, 'annotation'],
        [/'[^'\n]*'|"[^"\n]*"/, 'string'],
        [/\d+(\.\d+)?/, 'number'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@builtinTypes': 'type',
              '@default': 'identifier',
            },
          },
        ],
        [/[{}()[\];,.:=>+\-*/<>!&|]/, 'delimiter'],
      ],
    },
  });
  monaco.editor.defineTheme('tdsl-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'annotation', foreground: 'dcdcaa', fontStyle: 'bold' },
      { token: 'keyword', foreground: '569cd6' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'comment', foreground: '6a9955' },
    ],
    colors: {},
  });
}
