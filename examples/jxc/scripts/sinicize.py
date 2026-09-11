# jxc TDSL 中文化一次性转换 v2（从 spec.yaml 读标签，回写 tdsl 片段）
# 覆盖：枚举项 label / 页面 @title / 列 title / 表单 input label / 明细 repeat 字段 label
import io, os, yaml, re

ROOT = os.path.dirname(os.path.abspath(__file__)) + '/..'
spec = yaml.safe_load(io.open(os.path.join(ROOT, 'spec.yaml'), encoding='utf-8'))

def find_label(entity_id, field_id):
    for e in spec['data']['entities']:
        if e['id'] == entity_id:
            for fl in e['fields']:
                if fl['id'] == field_id:
                    return fl['name']
    return field_id

pages = {}
for m in spec['modules']:
    for f in m['functions']:
        for p in f['pages']:
            p['_module'] = m['name']
            pages[p['id']] = p

def balanced_block(s, start):
    """start 指向首个 '{'；返回块结束（含配平 '}'）下标"""
    depth, i, in_str = 0, start, False
    while i < len(s):
        c = s[i]
        if c == '"':
            in_str = not in_str
        elif not in_str:
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    raise ValueError('unbalanced')

for fn in sorted(os.listdir(os.path.join(ROOT, 'tdsl'))):
    if not fn.endswith('.tdsl'):
        continue
    path = os.path.join(ROOT, 'tdsl', fn)
    s = io.open(path, encoding='utf-8').read()

    # 1) 枚举项 label
    for en in spec['data']['enums']:
        m = re.search(r'enum ' + en['id'] + r' \{ ([^}]+) \}', s)
        if not m:
            continue
        items = [f"{it['key']}('{it['label']}')" if it.get('label') else it['key'] for it in en['items']]
        s = s.replace(m.group(0), 'enum ' + en['id'] + ' { ' + ', '.join(items) + ' }')

    # 2) 页面 @title + 块内列/字段标签
    for pid, p in pages.items():
        head = re.search(r'((?:@title\([^\n]*\)\n)?)(@?[a-z]*?)((?:page|dialog) ' + pid + r' \{)', s)
        if not head:
            continue
        if not head.group(1):
            # 在 page/dialog 声明行前插 @title + @menu（菜单分组，模块折叠）
            decl = re.search(r'(page|dialog) ' + pid + r' \{', s)
            s = s[:decl.start()] + f"@title('{p['name']}')\n@menu('{p['_module']}')\n" + s[decl.start():]
        elif '@menu(' not in head.group(1):
            # 已有 @title 但无 @menu → 在 @title 行后补一行
            decl = re.search(r'(page|dialog) ' + pid + r' \{', s)
            title_line_start = s.rindex('@title', 0, decl.start())
            title_line_end = s.index('\n', title_line_start)
            s = s[:title_line_end + 1] + f"@menu('{p['_module']}')\n" + s[title_line_end + 1:]

        brace = s.index('{', s.index(pid + ' {'))
        end = balanced_block(s, brace)
        blk = s[s.rindex('\n', 0, brace) + 1:end + 1]
        orig = blk
        ent = p.get('entity')

        for col in p.get('columns') or []:
            lbl = find_label(ent, col) if ent else None
            if lbl is not None:
                blk = re.sub(r'<column field="' + col + r'" />', f'<column field="{col}" title="{lbl}" />', blk)
        for fid in p.get('fields') or []:
            lbl = find_label(ent, fid) if ent else fid
            blk = re.sub(r'<input field="' + fid + r'" />', f'<input field="{fid}" label="{lbl}" />', blk)
        for sid in p.get('search') or []:
            lbl = find_label(ent, sid) if ent else '关键词'
            blk = re.sub(r'<input field="' + sid + r'" />', f'<input field="{sid}" label="{lbl}" />', blk)
        if p.get('subform'):
            for fid in p['subform']['fields']:
                lbl = find_label(p['subform']['entity'], fid)
                blk = re.sub(r'<input field="' + fid + r'" />', f'<input field="{fid}" label="{lbl}" />', blk)
        if blk != orig:
            s = s.replace(orig, blk)

    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print(f'{fn}: done')
