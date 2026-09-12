/**
 * C4 样卷（dev/28 C4）：jxc spec 按 5 模块切（含共享数据字典节选）+ fastjson2 demo + todo。
 * 每份样卷 = 独立可评测的结构化需求文本（spec 驱动：系统/模块/功能/页面/按钮/字段六层）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import type { Spec, SpecEntity, SpecPage } from './spec';

export interface EvalSample {
  id: string;
  title: string;
  /** 需求文本（喂给 LLM 的一道完整spec） */
  requirement: string;
  /** 精确覆盖对照（jxc 才有 check-spec 参照；其他样例为 null） */
  coverage: 'jxc-module' | 'none';
}


/** jxc spec 路径：examples/jxc/spec.yaml（从任意 cwd 定位仓库） */
function jxcSpecPath(): string {
  // eval 包运行时 cwd 可能在 packages/eval（npm -w），或仓库根——两级向上找 examples/jxc
  for (const base of [process.cwd(), join(process.cwd(), '..'), join(process.cwd(), '..', '..')]) {
    const p = join(base, 'examples', 'jxc', 'spec.yaml');
    try {
      readFileSync(p);
      return p;
    } catch { /* try next */ }
  }
  throw new Error('找不到 examples/jxc/spec.yaml（从仓库任意 cwd 运行皆可）');
}

/** jxc spec 读取（与 examples/jxc/scripts/check-spec.ts 同型；独立小载入避免耦合） */
export function loadJxcSpec(): Spec {
  const path = jxcSpecPath();
  const raw = yamlLoad(readFileSync(path, 'utf8')) as unknown;
  const o = raw as Record<string, unknown>;
  const ent = (v: unknown): SpecEntity => v as SpecEntity;
  const data = o['data'] as Record<string, unknown>;
  const mods = (o['modules'] as Array<Record<string, unknown>>).map((m) => ({
    id: m['id'] as string,
    name: m['name'] as string,
    functions: (m['functions'] as Array<Record<string, unknown>>).map((f) => ({
      id: f['id'] as string,
      name: f['name'] as string,
      pages: (f['pages'] as Array<Record<string, unknown>>).map((pg) => pg as unknown as SpecPage),
    })),
  }));
  return {
    system: o['system'] as Spec['system'],
    data: {
      enums: (data['enums'] as Array<Record<string, unknown>>).map((e) => ({
        id: e['id'] as string,
        name: e['name'] as string,
        items: (e['items'] as Array<{ key: string; label: string }>),
      })),
      entities: (data['entities'] as unknown[]).map(ent),
    },
    modules: mods,
  };
}

/** 模块页引用的实体 id（含 subform） */
function entitiesOf(pages: SpecPage[]): string[] {
  const ids = new Set<string>();
  for (const p of pages) {
    if (p.entity) ids.add(p.entity);
    if (p.subform) ids.add(p.subform.entity);
  }
  return [...ids];
}

function fieldText(e: SpecEntity): string {
  const rows = e.fields
    .map((f) => `  - ${f.id} ${f.type}${f.required ? '（必填）' : ''} // ${f.name}`)
    .join('\n');
  return `${e.id}（${e.name}）:\n${rows}`;
}

function pageText(pg: SpecPage): string {
  const lines: string[] = [];
  lines.push(`- 页面 ${pg.id}（${pg.name}，类型 ${pg.kind}${pg.entity ? `，实体 ${pg.entity}` : ''}）`);
  if (pg.query) lines.push(`  主查询逻辑: ${pg.query}`);
  if (pg.columns?.length) lines.push(`  列表列: ${pg.columns.join('、')}`);
  if (pg.search?.length) lines.push(`  查询条件: ${pg.search.join('、')}`);
  if (pg.fields?.length) lines.push(`  表单字段: ${pg.fields.join('、')}`);
  if (pg.subform) lines.push(`  明细子表: repeat 字段 ${pg.subform.repeat}（${pg.subform.entity}），字段 ${pg.subform.fields.join('、')}`);
  for (const b of pg.buttons ?? []) {
    const act = b.action ? `，动作 ${b.action.type}('${b.action.target}')` : '';
    lines.push(`  按钮 ${b.name}（${b.scope}）${act}`);
  }
  return lines.join('\n');
}

/** 单模块 → 完整需求文本（含共享枚举/引用实体） */
export function moduleRequirement(spec: Spec, moduleId: string): { module: string; text: string } | null {
  const mod = spec.modules.find((m) => m.id === moduleId);
  if (!mod) return null;
  const pagesAll = mod.functions.flatMap((f) => f.pages);
  const entIds = entitiesOf(pagesAll);
  const usedEnums = new Set<string>();
  const ents = spec.data.entities.filter((e) => entIds.includes(e.id));
  for (const e of ents) {
    for (const f of e.fields) {
      const t = f.type;
      const en = spec.data.enums.find((x) => x.id === t);
      if (en) usedEnums.add(en.id);
    }
  }
  const enums = spec.data.enums.filter((x) => usedEnums.has(x.id));

  const parts: string[] = [];
  parts.push(`系统：${spec.system.name}（id=jxc）`);
  parts.push('');
  parts.push(`── 数据字典（枚举） ──`);
  for (const en of enums) parts.push(`enum ${en.id} { ${en.items.map((it) => `${it.key}`).join('、')} } // ${en.name}：${en.items.map((it) => `${it.key}=${it.label}`).join('、')}`);
  parts.push('');
  parts.push(`── 实体 ──`);
  for (const e of ents) parts.push(entityText(e));
  parts.push('');
  parts.push(`── 模块 ${mod.name}（id=${mod.id}） ──`);
  for (const f of mod.functions) {
    parts.push(`功能 ${f.name}（id=${f.id}）`);
    for (const pg of f.pages) parts.push(pageText(pg));
  }
  parts.push('');
  parts.push('要求：输出单个 TDSL 文件，包含以上实体 + @export function（页面绑定与按钮动作都要接通）+ interface + page/dialog 声明，覆盖上列所有页面与按钮。');
  parts.push('命名映射：页面 id = TDSL page/dialog 名；按钮 name = button text；主查询/动作 target = TDSL function 名。');
  parts.push('业务规则提示（来自原系统）：单据仅 暂存(DRAFT)/已提交(SUBMITTED) 两态；提交后不可编辑删除。');
  return { module: moduleId, text: parts.join('\n') };
}

function entityText(e: SpecEntity): string {
  const rows = e.fields
    .map((f) => `  ${f.id}: ${f.type}${f.required ? '' : ' @nullable'};  // ${f.name}`)
    .join('\n');
  return `entity ${e.id} {\n${rows}\n}`;
}

/** 全量样卷（7 份）：jxc×5 模块 + fastjson2 demo + todo */
export function buildSamples(): EvalSample[] {
  const spec = loadJxcSpec();
  const out: EvalSample[] = [];
  for (const m of spec.modules) {
    const r = moduleRequirement(spec, m.id);
    if (r) out.push({ id: `jxc-${m.id}`, title: `进销存·${m.name}`, requirement: r.text, coverage: 'jxc-module' });
  }
  out.push({ id: 'fastjson-demo', title: 'fastjson2 直调（JSON.toJSONString/parseObject）', requirement: FASTJSON_SPEC, coverage: 'none' });
  out.push({ id: 'todo', title: 'Todo 单表 CRUD', requirement: TODO_SPEC, coverage: 'none' });
  return out;
}

const FASTJSON_SPEC = `系统：fastjson2 演示应用（fastjson2 是外部 jar，通过 FFI 目录已可直接调：com.alibaba.fastjson2.JSON 类提供 toJSONString(Object): String 与 parseObject(String): Object 静态方法；JSONObject 提供 getString/getInteger/containsKey）
要求（单文件 TDSL）：
- function toJson(o: Object): String —— 直接调 JSON.toJSONString
- function hasKey(json: String, key: String): Boolean —— parseObject 后调 containsKey
- interface FastjsonApi：POST '/api/to-json' -> toJson、POST '/api/has-key' -> hasKey`;

const TODO_SPEC = `系统：Todo 待办（单表）
实体 Todo { id: Integer（主键）; title: String（必填）; done: Boolean; }
要求（单文件 TDSL）：
- function listTodos(): List<Todo> —— 全表
- function createTodo(input: TodoInput): Todo —— struct TodoInput { title: String }
- function toggleTodo(id: Integer): Todo —— 翻转 done 并 save
- function deleteTodo(id: Integer): Boolean
- interface TodoApi：'/api/todos' GET/POST、'/api/todos/{id}' DELETE + toggle
- page TodoList：表格列 title/done，行按钮 翻转(toggleTodo)/删除(deleteTodo)，页面按钮 新增（跳转 or 弹窗自选）`;
