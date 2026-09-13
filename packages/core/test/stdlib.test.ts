import { describe, expect, it } from 'vitest';
import { createCatalog, FFI_CORE, depCoordinate, depMatches, type LoadedCatalog } from '../src/index';

const FASTJSON: LoadedCatalog = {
  eco: 'java',
  coordinate: 'com.alibaba:fastjson2:2.0.58',
  classes: [
    { class: 'com.alibaba.fastjson2.JSON', alias: 'JSON', members: [{ name: 'toJSONString', static: true, params: ['Object'], ret: 'String' }] },
  ],
};

const JACKSON: LoadedCatalog = {
  eco: 'java',
  coordinate: 'com.fasterxml.jackson.core:jackson-databind:2.17.0',
  classes: [
    { class: 'com.fasterxml.jackson.databind.json.JSON', alias: 'JSON', members: [] },
  ],
};

describe('core/dev32 依赖目录', () => {
  it('FFI_CORE 只含语言自有五域（无第三方坐标）', () => {
    expect(FFI_CORE.map((c) => c.alias).sort()).toEqual(['Date', 'DateTime', 'Decimal', 'List', 'String']);
    expect(FFI_CORE.every((c) => !c.maven)).toBe(true);
  });

  it('createCatalog：产物类补 maven 坐标，裸 alias 唯一命中', () => {
    const cat = createCatalog([FASTJSON], [{ eco: 'java', name: 'com.alibaba:fastjson2', version: '2.0.58' }]);
    const cls = cat.byAlias('JSON');
    expect(cls?.class).toBe('com.alibaba.fastjson2.JSON');
    expect(cls?.maven).toBe('com.alibaba:fastjson2:2.0.58');
    expect(cat.collisions).toHaveLength(0);
  });

  it('同名类跨 jar 撞 alias → collisions 记录双方坐标，裸名不再唯一命中', () => {
    const cat = createCatalog([FASTJSON, JACKSON], [
      { eco: 'java', name: 'com.alibaba:fastjson2', version: '2.0.58' },
      { eco: 'java', name: 'com.fasterxml.jackson.core:jackson-databind', version: '2.17.0' },
    ]);
    expect(cat.byAlias('JSON')).toBeUndefined();
    expect(cat.collisions).toHaveLength(1);
    expect(cat.collisions[0].alias).toBe('JSON');
    expect(cat.collisions[0].coordinates).toHaveLength(2);
  });

  it('as ns：限定引用命中，不占裸 alias，不参与撞车', () => {
    const cat = createCatalog([FASTJSON, JACKSON], [
      { eco: 'java', name: 'com.alibaba:fastjson2', version: '2.0.58' },
      { eco: 'java', name: 'com.fasterxml.jackson.core:jackson-databind', version: '2.17.0', ns: 'jackson' },
    ]);
    expect(cat.byQualified('jackson', 'JSON')?.class).toBe('com.fasterxml.jackson.databind.json.JSON');
    expect(cat.byQualified('nope', 'JSON')).toBeUndefined();
    expect(cat.byAlias('JSON')?.class).toBe('com.alibaba.fastjson2.JSON');
    expect(cat.collisions).toHaveLength(0);
  });

  it('产物 alias 与内核五域冲突也记 collision', () => {
    const cat = createCatalog([{
      eco: 'java',
      coordinate: 'g:x:1',
      classes: [{ class: 'x.String', alias: 'String', members: [] }],
    }], [{ eco: 'java', name: 'g:x', version: '1' }]);
    expect(cat.collisions).toHaveLength(1);
    expect(cat.byAlias('String')).toBeUndefined();
  });

  it('depMatches：java 按 : 匹配 name 段（版本通配），npm 按 @', () => {
    expect(depMatches({ eco: 'java', name: 'g:a', version: '1' }, 'g:a:1')).toBe(true);
    expect(depMatches({ eco: 'java', name: 'g:a', version: '1' }, 'g:a:2')).toBe(true);
    expect(depMatches({ eco: 'java', name: 'g:a', version: '1' }, 'g:b:1')).toBe(false);
    expect(depMatches({ eco: 'npm', name: 'antd' }, 'antd@^5.0.0')).toBe(true);
    expect(depMatches({ eco: 'npm', name: 'antd' }, 'antd')).toBe(true);
    expect(depCoordinate({ name: 'g:a', version: '1' })).toBe('g:a:1');
  });
});
