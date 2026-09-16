import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 通用性守门（架构护栏）：编译器与生成器（core/parser/typecheck/codegen-java/codegen-react）
 * 的**源码**里不得出现具体业务/样例域词汇——业务知识属于 DSL（样例/用户工程），
 * 生成器只允许：语言内核（core/stdlib 的 java/js 模板）、通用命名约定、UI 库映射。
 * 历史教训：曾把 `topool → 已放入公海`、`APPROV/REJECT → 颜色` 这类业务表写进生成器。
 */
const COMPILER_PKGS = ['core', 'parser', 'typecheck', 'codegen-java', 'codegen-react'];

/** 样例/业务域词汇（出现在编译器源码即视为泄漏；测试夹具不受限） */
const DOMAIN_DENYLIST = [
  // 样例专名
  'yudao',
  'supplier',
  'warehouse',
  'purchaseorder',
  'purchasein',
  'saleorder',
  'saleout',
  'stockcheck',
  'owneruserid',
  'crmclue',
  'crmcustomer',
  'contract',
  'customer',
  'clue',
  'invoice',
  // 业务动词/名词（中文）
  '审批',
  '领取',
  '公海',
  '回款',
  '商机',
  '线索',
  '采购',
  '销售',
  '库存',
  '供应商',
  '仓库',
  '合同',
  '客户',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 去掉块注释与行注释，避免注释里的举例误报 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('通用性守门：编译器源码不含业务域词汇（架构护栏）', () => {
  it('core/parser/typecheck/codegen-java/codegen-react 的 src 无业务词泄漏', () => {
    const root = resolve(__dirname, '../..');
    const hits: string[] = [];
    for (const pkg of COMPILER_PKGS) {
      for (const file of walk(join(root, pkg, 'src'))) {
        const code = stripComments(readFileSync(file, 'utf8')).toLowerCase();
        for (const word of DOMAIN_DENYLIST) {
          if (code.includes(word.toLowerCase())) hits.push(`${pkg}/src${file.slice(join(root, pkg, 'src').length)}: ${word}`);
        }
      }
    }
    expect(hits, `业务词汇不得写入编译器/生成器（应放进 DSL 样例或用注解声明）：\n${hits.join('\n')}`).toEqual([]);
  });
});
