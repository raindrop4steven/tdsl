/**
 * Prompt Pack 组装（Prompt Pack ①②③④⑤ 五层，dev/19 §3）。
 * 纯函数拼装，不做任何 LLM API 调用——调用方拿文本自己发请求。
 */
import { SYNTAX_CHEATSHEET } from './cheatsheet';
import { autoMatchExamples, selectExamples, type Example } from './examples';

export interface ComposeOptions {
  /** 用户自然语言需求（④层） */
  requirement: string;
  /** 按域选择示例：示例 id / 域名 / 关键词（不传则取默认顺序前 N 个） */
  domains?: string[];
  /** 最多注入几个示例（默认 2） */
  maxExamples?: number;
}

const ROLE = `你是 TDSL 编译器的书写前端。TDSL 是一种 TS 风格的低代码领域语言（不是严格 TypeScript），
你的输出将被 parser 直接编译为 Typed AST 并生成 React + Java 工程。
严格按给定语法与示例书写，禁止输出解释性文字。`;

const OUTPUT_CONTRACT = `// ===== 输出契约 =====
// 只输出一个完整的 TDSL 源文件内容：
// - 不要 markdown 代码块包裹（不要 \`\`\`）
// - 不要任何解释、注释以外的前后缀文字
// - 文件必须能独立通过 parser 编译（引用的类型/逻辑/页面都要在本文件内声明）`;

/** 组装完整 prompt（五层：角色 → 语法速查 → 示例矩阵 → 需求 → 输出契约） */
export function composePrompt(opts: ComposeOptions): string {
  // 示例选择：显式 domains > 需求文本自动匹配关键词 > 默认顺序
  const examples: Example[] =
    opts.domains && opts.domains.length > 0
      ? selectExamples(opts.domains, opts.maxExamples ?? 2)
      : autoMatchExamples(opts.requirement, opts.maxExamples ?? 2);
  const exampleBlocks = examples
    .map((e) => `// ===== 示例【${e.domain}】${e.description} =====\n${e.tdsl}`)
    .join('\n\n');
  return [
    ROLE,
    '',
    SYNTAX_CHEATSHEET,
    '',
    '// ===== 示例矩阵（完整可编译样例，从最相近的领域归纳写法）=====',
    exampleBlocks,
    '',
    '// ===== 用户需求 =====',
    opts.requirement,
    '',
    OUTPUT_CONTRACT,
  ].join('\n');
}
