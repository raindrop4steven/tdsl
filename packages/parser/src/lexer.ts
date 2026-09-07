export type TokenType = 'ident' | 'string' | 'number' | 'punct' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

const PUNCT_SINGLE = '{}()[];,:.=<>!+-@';

/** 将 TDSL 文本切分为 token 流（保留行列，供错误定位） */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const push = (type: TokenType, value: string, l: number, c: number) => {
    tokens.push({ type, value, line: l, col: c });
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === '\n') {
      line++;
      col = 1;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      col++;
      continue;
    }
    // 行注释 //
    if (ch === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }

    const startLine = line;
    const startCol = col;

    // 字符串字面量 '...'
    if (ch === "'") {
      let s = '';
      i++;
      col++;
      while (i < input.length && input[i] !== "'") {
        if (input[i] === '\n') {
          line++;
          col = 1;
        }
        s += input[i];
        i++;
        col++;
      }
      if (input[i] !== "'") {
        throw new Error(`unterminated string at ${startLine}:${startCol}`);
      }
      i++;
      col++;
      push('string', s, startLine, startCol);
      continue;
    }

    // 数字字面量
    if (/[0-9]/.test(ch)) {
      let s = '';
      while (i < input.length && /[0-9.]/.test(input[i])) {
        s += input[i];
        i++;
        col++;
      }
      push('number', s, startLine, startCol);
      continue;
    }

    // 标识符 / 关键字
    if (/[A-Za-z_]/.test(ch)) {
      let s = '';
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) {
        s += input[i];
        i++;
        col++;
      }
      push('ident', s, startLine, startCol);
      continue;
    }

    // 三字符运算符 === !==
    const three = input.slice(i, i + 3);
    if (three === '===' || three === '!==') {
      push('punct', three, startLine, startCol);
      i += 3;
      col += 3;
      continue;
    }

    // 双字符运算符 && || <= :=
    const two = input.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '<=' || two === ':=') {
      push('punct', two, startLine, startCol);
      i += 2;
      col += 2;
      continue;
    }

    // 单字符标点
    if (PUNCT_SINGLE.includes(ch)) {
      push('punct', ch, startLine, startCol);
      i++;
      col++;
      continue;
    }

    throw new Error(`unexpected char '${ch}' at ${line}:${col}`);
  }

  tokens.push({ type: 'eof', value: '<eof>', line, col });
  return tokens;
}