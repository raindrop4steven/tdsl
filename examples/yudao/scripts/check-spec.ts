/**
 * Spec 覆盖度对照器：spec.yaml（结构化需求 Spec）× tdsl/*.tdsl（TDSL 实现）
 *
 * 五维自动对照（全部 error 级）：
 *   1. 实体/字段：spec 实体→TDSL entity 存在；字段存在 + 类型相容 + required 不与 @nullable 冲突
 *   2. 枚举：spec 枚举/枚举项 → TDSL enum 存在
 *   3. 页面：spec page.id → TDSL page/dialog 存在（kind 相符）；列/表单字段/明细子表字段在场
 *   4. 按钮：spec 按钮 name → 页面内 text 匹配的 button 在场
 *   5. 动作绑定：button.action 目标存在（logic/dialog/page）且页面实际引用
 *
 * 缺口非零 → exit 1（可进 CI）。本脚本只做结构对照，语义缺口另行记录。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { parseProject } from '@tdsl/parser';
import type {
  AppNode,
  EntityNode,
  EnumNode,
  LogicNode,
  ViewElementNode,
  ViewNode,
  TypeRef,
} from '@tdsl/core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------- Spec 类型 ----------

interface SpecField {
  id: string;
  name: string;
  type: string;
  required?: boolean;
}
interface SpecEntity {
  id: string;
  name: string;
  fields: SpecField[];
}
interface SpecEnumItem {
  key: string;
  label: string;
}
interface SpecEnum {
  id: string;
  name: string;
  items: SpecEnumItem[];
}
interface SpecAction {
  type: 'openDialog' | 'logic' | 'navigate';
  target: string;
}
interface SpecButton {
  id: string;
  name: string;
  scope: 'page' | 'row';
  action?: SpecAction;
}
interface SpecSubform {
  repeat: string;
  entity: string;
  fields: string[];
}
interface SpecPage {
  id: string;
  name: string;
  kind: 'list' | 'dialog-form' | 'detail';
  entity?: string;
  query?: string;
  columns?: string[];
  search?: string[];
  fields?: string[];
  subform?: SpecSubform;
  buttons?: SpecButton[];
}
interface SpecFunction {
  id: string;
  name: string;
  pages: SpecPage[];
}
interface SpecModule {
  id: string;
  name: string;
  functions: SpecFunction[];
}
interface Spec {
  system: { id: string; name: string; description: string };
  data: { enums: SpecEnum[]; entities: SpecEntity[] };
  modules: SpecModule[];
}

// ---------- 严格读取工具（禁 any，畸形 Spec 直接报清晰错误） ----------

function asObj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`spec.yaml 格式错误：${what} 应为对象`);
  }
  return v as Record<string, unknown>;
}
function asArr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`spec.yaml 格式错误：${what} 应为数组`);
  return v;
}
function asStr(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`spec.yaml 格式错误：${what} 应为字符串`);
  return v;
}
function optStr(o: Record<string, unknown>, k: string, what: string): string | undefined {
  return o[k] === undefined ? undefined : asStr(o[k], `${what}.${k}`);
}

function readField(v: unknown, what: string): SpecField {
  const o = asObj(v, what);
  return {
    id: asStr(o.id, `${what}.id`),
    name: asStr(o.name, `${what}.name`),
    type: asStr(o.type, `${what}.type`),
    required: o.required === true,
  };
}

function readEntity(v: unknown, what: string): SpecEntity {
  const o = asObj(v, what);
  return {
    id: asStr(o.id, `${what}.id`),
    name: asStr(o.name, `${what}.name`),
    fields: asArr(o.fields, `${what}.fields`).map((f, i) => readField(f, `${what}.fields[${i}]`)),
  };
}

function readAction(v: unknown, what: string): SpecAction {
  const o = asObj(v, what);
  const type = asStr(o.type, `${what}.type`);
  if (type !== 'openDialog' && type !== 'logic' && type !== 'navigate') {
    throw new Error(`spec.yaml 格式错误：${what}.type 非法 '${type}'`);
  }
  return { type, target: asStr(o.target, `${what}.target`) };
}

function readButton(v: unknown, what: string): SpecButton {
  const o = asObj(v, what);
  const scope = o.scope === 'row' ? 'row' : 'page';
  return {
    id: asStr(o.id, `${what}.id`),
    name: asStr(o.name, `${what}.name`),
    scope,
    action: o.action === undefined ? undefined : readAction(o.action, `${what}.action`),
  };
}

function readPage(v: unknown, what: string): SpecPage {
  const o = asObj(v, what);
  const kind = asStr(o.kind, `${what}.kind`);
  if (kind !== 'list' && kind !== 'dialog-form' && kind !== 'detail') {
    throw new Error(`spec.yaml 格式错误：${what}.kind 非法 '${kind}'`);
  }
  let subform: SpecSubform | undefined;
  if (o.subform !== undefined) {
    const s = asObj(o.subform, `${what}.subform`);
    subform = {
      repeat: asStr(s.repeat, `${what}.subform.repeat`),
      entity: asStr(s.entity, `${what}.subform.entity`),
      fields: asArr(s.fields, `${what}.subform.fields`).map((f, i) =>
        asStr(f, `${what}.subform.fields[${i}]`),
      ),
    };
  }
  return {
    id: asStr(o.id, `${what}.id`),
    name: asStr(o.name, `${what}.name`),
    kind: kind as SpecPage['kind'],
    entity: optStr(o, 'entity', what),
    query: optStr(o, 'query', what),
    columns: o.columns === undefined ? undefined : asArr(o.columns, `${what}.columns`).map((c, i) => asStr(c, `${what}.columns[${i}]`)),
    search: o.search === undefined ? undefined : asArr(o.search, `${what}.search`).map((c, i) => asStr(c, `${what}.search[${i}]`)),
    fields: o.fields === undefined ? undefined : asArr(o.fields, `${what}.fields`).map((c, i) => asStr(c, `${what}.fields[${i}]`)),
    subform,
    buttons: o.buttons === undefined ? undefined : asArr(o.buttons, `${what}.buttons`).map((b, i) => readButton(b, `${what}.buttons[${i}]`)),
  };
}

function readSpec(raw: unknown): Spec {
  const root = asObj(raw, '根节点');
  const systemO = asObj(root.system, 'system');
  const dataO = asObj(root.data, 'data');
  const modules = asArr(root.modules, 'modules').map((m, i) => {
    const mo = asObj(m, `modules[${i}]`);
    const functions = asArr(mo.functions, `modules[${i}].functions`).map((f, j) => {
      const fo = asObj(f, `modules[${i}].functions[${j}]`);
      return {
        id: asStr(fo.id, `functions[${j}].id`),
        name: asStr(fo.name, `functions[${j}].name`),
        pages: asArr(fo.pages, `functions[${j}].pages`).map((p, k) =>
          readPage(p, `functions[${j}].pages[${k}]`),
        ),
      };
    });
    return {
      id: asStr(mo.id, `modules[${i}].id`),
      name: asStr(mo.name, `modules[${i}].name`),
      functions,
    };
  });
  return {
    system: {
      id: asStr(systemO.id, 'system.id'),
      name: asStr(systemO.name, 'system.name'),
      description: asStr(systemO.description, 'system.description'),
    },
    data: {
      enums: asArr(dataO.enums, 'data.enums').map((e, i) => {
        const eo = asObj(e, `data.enums[${i}]`);
        return {
          id: asStr(eo.id, `enums[${i}].id`),
          name: asStr(eo.name, `enums[${i}].name`),
          items: asArr(eo.items, `enums[${i}].items`).map((it, j) => {
            const io = asObj(it, `enums[${i}].items[${j}]`);
            return { key: asStr(io.key, `items[${j}].key`), label: asStr(io.label, `items[${j}].label`) };
          }),
        };
      }),
      entities: asArr(dataO.entities, 'data.entities').map((e, i) => readEntity(e, `data.entities[${i}]`)),
    },
    modules,
  };
}

// ---------- 对照逻辑 ----------

interface Gap {
  dim: string;
  where: string;
  expect: string;
  actual: string;
}

/** 全局检查项计数（每个 leaf check 恒 +1，无论过否） */
let leafTotal = 0;

class Tally {
  check(ok: boolean, gap: Gap): boolean {
    leafTotal++;
    if (!ok) this.gaps.push(gap);
    return ok;
  }
  constructor(private gaps: Gap[]) {}
}

function flattenEntities(spec: Spec): SpecEntity[] {
  return spec.data.entities;
}

/** spec 字段类型 ↔ TDSL TypeRef 相容性（Decimal 精度细化视为相容；枚举按引用名） */
function typeMatches(specType: string, tr: TypeRef): boolean {
  if (specType.startsWith('Decimal')) {
    return (tr.kind === 'db' && tr.builtin === 'decimal') || (tr.kind === 'primitive' && tr.builtin === 'Decimal');
  }
  if (tr.kind === 'primitive') return specType === tr.builtin;
  if (tr.kind === 'reference') return tr.path === specType || tr.path.endsWith('.' + specType);
  return false;
}

/** 绑定 target 匹配：链接后为 nodePath（app.logics.x），链接前为短名 */
function targetIs(target: string, name: string): boolean {
  return target === name || target.endsWith('.' + name);
}

function allElements(els: ViewElementNode[]): ViewElementNode[] {
  const out: ViewElementNode[] = [];
  const walk = (list: ViewElementNode[]): void => {
    for (const el of list) {
      out.push(el);
      walk(el.children);
    }
  };
  walk(els);
  return out;
}

function fieldOf(el: ViewElementNode): string | undefined {
  const v = el.props['field'];
  return typeof v === 'string' ? v : undefined;
}

function main(): void {
  // 1. 读 Spec
  const spec = readSpec(yamlLoad(readFileSync(join(ROOT, 'spec.yaml'), 'utf8')));
  console.log(`Spec: ${spec.system.name}（${spec.data.entities.length} 实体 / ${spec.data.enums.length} 枚举 / ${spec.modules.length} 模块）`);

  // 2. 解析 TDSL（多文件）
  const tdslDir = join(ROOT, 'tdsl');
  const files = readdirSync(tdslDir)
    .filter((f) => f.endsWith('.tdsl'))
    .sort()
    .map((f) => ({ path: f, content: readFileSync(join(tdslDir, f), 'utf8') }));
  let app: AppNode;
  try {
    app = parseProject(files, spec.system.id);
  } catch (e) {
    console.error('TDSL 解析失败（对照中止）：', e instanceof Error ? e.message : e);
    process.exit(2);
  }

  const tdslEntities = new Map<string, EntityNode>();
  for (const ds of app.datasources) for (const e of ds.entities) tdslEntities.set(e.name, e);
  const tdslEnums = new Map<string, EnumNode>();
  for (const e of app.enums) tdslEnums.set(e.name, e);
  const tdslViews = new Map<string, ViewNode>();
  for (const v of app.views) tdslViews.set(v.name, v);
  const tdslLogics = new Map<string, LogicNode>();
  for (const l of app.logics) tdslLogics.set(l.name, l);

  const gaps: Gap[] = [];

  // 3. 维度一：实体/字段
  console.log('\n── 维度 1：实体/字段 ──');
  for (const ent of flattenEntities(spec)) {
    const where = `实体 ${ent.id}(${ent.name})`;
    const got = tdslEntities.get(ent.id);
    if (!new Tally(gaps).check(got !== undefined, { dim: '实体', where, expect: 'entity 存在', actual: '缺失' })) {
      console.log(`  ✗ ${where}: entity 缺失`);
      continue;
    }
    let missing = 0;
    for (const f of ent.fields) {
      const prop = got!.properties.find((p) => p.name === f.id);
      const t = new Tally(gaps);
      const ok = t.check(prop !== undefined, {
        dim: '字段',
        where: `${where}.${f.id}(${f.name})`,
        expect: `类型 ${f.type}${f.required ? ' 必填' : ''}`,
        actual: '字段缺失',
      });
      if (!ok) {
        missing++;
        continue;
      }
      if (!t.check(typeMatches(f.type, prop!.type), {
        dim: '字段',
        where: `${where}.${f.id}`,
        expect: `类型 ${f.type}`,
        actual: '类型不相容',
      })) missing++;
      if (f.required && prop!.nullable) {
        t.check(false, { dim: '字段', where: `${where}.${f.id}`, expect: '必填', actual: '标记了 @nullable' });
        missing++;
      }
    }
    console.log(missing === 0 ? `  ✓ ${ent.id}（${ent.fields.length} 字段）` : `  ✗ ${ent.id}: ${missing} 处缺口`);
  }

  // 4. 维度二：枚举
  console.log('\n── 维度 2：枚举 ──');
  for (const en of spec.data.enums) {
    const got = tdslEnums.get(en.id);
    let line = `  ${got ? '✓' : '✗'} ${en.id}`;
    const t = new Tally(gaps);
    if (got !== undefined) {
      for (const it of en.items) {
        const ok = t.check(got.items.some((i) => i.name === it.key), {
          dim: '枚举项',
          where: `${en.id}.${it.key}(${it.label})`,
          expect: '枚举项存在',
          actual: '缺失',
        });
        if (!ok) line += `\n    ✗ 缺枚举项 ${it.key}(${it.label})`;
      }
    } else {
      t.check(false, { dim: '枚举', where: en.id, expect: 'enum 存在', actual: '缺失' });
    }
    console.log(line);
  }

  // 5. 维度 3/4/5：页面/按钮/动作
  for (const mod of spec.modules) {
    console.log(`\n── 模块 ${mod.name} ──`);
    for (const fn of mod.functions) {
      for (const page of fn.pages) {
        const where = `${fn.name}/${page.id}(${page.name})`;
        const view = tdslViews.get(page.id);
        // detail（详情）在 TDSL 中以右侧抽屉实现（与编辑/新建一致）→ 期望 dialog
        const wantKind = page.kind === 'dialog-form' || page.kind === 'detail' ? 'dialog' : 'page';
        if (view === undefined) {
          gaps.push({ dim: '页面', where, expect: `${wantKind} 存在`, actual: '缺失' });
          console.log(`  ✗ ${where}: 视图缺失`);
          continue;
        }
        if (view.viewKind !== wantKind) {
          gaps.push({ dim: '页面', where, expect: `${wantKind}`, actual: `实为 ${view.viewKind}` });
          console.log(`  ✗ ${where}: 期望 ${wantKind} 实为 ${view.viewKind}`);
        }
        const els = allElements(view.elements);
        const pageGaps: string[] = [];

        if (page.query !== undefined && !tdslLogics.has(page.query)) {
          pageGaps.push(`查询逻辑 ${page.query} 缺失`);
          gaps.push({ dim: '页面', where, expect: `logic ${page.query}`, actual: '缺失' });
        }

        if (page.columns !== undefined) {
          const table = els.find((e) => e.type === 'table');
          if (table === undefined) {
            pageGaps.push('缺 <table>');
            gaps.push({ dim: '页面', where, expect: '<table>', actual: '缺失' });
          } else {
            const tableEls = allElements(table.children);
            for (const col of page.columns) {
              const ok = tableEls.some((e) => e.type === 'column' && fieldOf(e) === col);
              if (!ok) {
                pageGaps.push(`列 ${col} 缺失`);
                gaps.push({ dim: '列', where, expect: `<column field="${col}">`, actual: '缺失' });
              }
            }
          }
        }

        for (const fid of page.fields ?? []) {
          if (!els.some((e) => fieldOf(e) === fid)) {
            pageGaps.push(`表单字段 ${fid} 缺失`);
            gaps.push({ dim: '表单字段', where, expect: `field=${fid}`, actual: '缺失' });
          }
        }
        for (const sid of page.search ?? []) {
          if (!els.some((e) => fieldOf(e) === sid)) {
            pageGaps.push(`查询条件 ${sid} 缺失`);
            gaps.push({ dim: '查询条件', where, expect: `field=${sid}`, actual: '缺失' });
          }
        }

        if (page.subform !== undefined) {
          const rep = els.find((e) => e.type === 'repeat' && fieldOf(e) === page.subform!.repeat);
          if (rep === undefined) {
            pageGaps.push(`明细 repeat ${page.subform.repeat} 缺失`);
            gaps.push({ dim: '明细子表', where, expect: `<repeat field="${page.subform.repeat}">`, actual: '缺失' });
          } else {
            const repEls = allElements(rep.children);
            for (const fid of page.subform.fields) {
              if (!repEls.some((e) => fieldOf(e) === fid)) {
                pageGaps.push(`明细字段 ${fid} 缺失`);
                gaps.push({ dim: '明细子表', where, expect: `field=${fid}`, actual: '缺失' });
              }
            }
          }
        }

        const buttons = els.filter((e) => e.type === 'button');
        const pageBindings = els.flatMap((e) => e.bindings);
        for (const btn of page.buttons ?? []) {
          const btnEl = buttons.find((b) => b.props['text'] === btn.name);
          if (btnEl === undefined) {
            pageGaps.push(`按钮「${btn.name}」缺失`);
            gaps.push({ dim: '按钮', where, expect: `text="${btn.name}"`, actual: '缺失' });
            continue;
          }
          if (btn.action !== undefined) {
            const a = btn.action;
            if (a.type === 'logic') {
              if (!tdslLogics.has(a.target)) {
                pageGaps.push(`按钮「${btn.name}」逻辑 ${a.target} 缺失`);
                gaps.push({ dim: '动作', where: `${where}·${btn.name}`, expect: `logic ${a.target}`, actual: '缺失' });
              }
              if (!pageBindings.some((b) => targetIs(b.target, a.target))) {
                pageGaps.push(`按钮「${btn.name}」未绑定 ${a.target}`);
                gaps.push({ dim: '动作', where: `${where}·${btn.name}`, expect: `页面绑定 ${a.target}`, actual: '未引用' });
              }
            } else if (a.type === 'openDialog') {
              const dv = tdslViews.get(a.target);
              if (dv === undefined || dv.viewKind !== 'dialog') {
                pageGaps.push(`按钮「${btn.name}」目标 ${a.target} 不是 dialog`);
                gaps.push({ dim: '动作', where: `${where}·${btn.name}`, expect: `dialog ${a.target}`, actual: dv === undefined ? '缺失' : '非 dialog' });
              }
              if (!pageBindings.some((b) => b.name === 'openDialog' && b.target === a.target)) {
                pageGaps.push(`按钮「${btn.name}」未 openDialog(${a.target})`);
                gaps.push({ dim: '动作', where: `${where}·${btn.name}`, expect: `openDialog(${a.target})`, actual: '未引用' });
              }
            } else {
              const tv = tdslViews.get(a.target);
              if (tv === undefined || tv.viewKind !== 'page') {
                pageGaps.push(`按钮「${btn.name}」目标 ${a.target} 不是 page`);
                gaps.push({ dim: '动作', where: `${where}·${btn.name}`, expect: `page ${a.target}`, actual: tv === undefined ? '缺失' : '非 page' });
              }
              if (!pageBindings.some((b) => b.name === 'navigate' && b.target === a.target)) {
                pageGaps.push(`按钮「${btn.name}」未 navigate(${a.target})`);
                gaps.push({ dim: '动作', where: `${where}·${btn.name}`, expect: `navigate(${a.target})`, actual: '未引用' });
              }
            }
          }
        }

        console.log(pageGaps.length === 0 ? `  ✓ ${where}` : `  ✗ ${where}\n      ${pageGaps.join('\n      ')}`);
      }
    }
  }

  // 6. 报告
  const coverage = ((leafTotal - gaps.length) / leafTotal) * 100;

  console.log('\n════════ 对照报告 ════════');
  console.log(`检查项: ${leafTotal}  缺口: ${gaps.length}  覆盖率: ${coverage.toFixed(1)}%`);
  if (gaps.length > 0) {
    console.log('\n缺口清单:');
    for (const g of gaps) console.log(`  [${g.dim}] ${g.where} — 期望 ${g.expect}，${g.actual}`);
    process.exit(1);
  }
  console.log('\n✅ Spec 全量覆盖：五维对照零缺口');
}

main();
