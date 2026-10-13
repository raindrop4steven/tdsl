---
name: tdsl-spec-first
description: TDSL 需求先行工作流（Spec 驱动开发，SDD）。Use when 接到用户业务需求要写 TDSL、需求模糊需要先结构化、要新建或修改一个 TDSL 工程、需要对拍需求覆盖率。
---

# Spec 先行：需求 → Spec → TDSL → 对照

> [English](SKILL.en.md) · **中文**

> 接到需求**先写 spec（或改现有 spec），再写 TDSL**——这是本项目验证过的主线方法论
> （jxc 进销存、yudao ERP 均按此交付，对照覆盖率 100%）。
> 好处：① 需求结构化后遗漏显形；② spec 是和用户对齐的契约（改动先改 spec）；③ 对照器可自动验证"写了没漏"。

## 工作流

```
1. 接需求 → 读工程现有 spec.yaml（有则改，无则建）
2. 按六层格式把需求落进 spec（不确定的字段/按钮列全，别凭空脑补）
3. 与用户确认 spec（这份就是需求清单）
4. 按 spec 写/改 tdsl 分片（参照 ../fewshot/ 与 ../demo-yudao/）
5. tdsl check → 0 error（../errors/ 修错）
6. check-spec 对照（若工程带对照器）→ 补缺口到 100%
```

## spec.yaml 六层格式

```
system:                  # ① 系统：一句话定位
  id: yudao
  name: 芋道 ERP/CRM 业务中台
  description: >- ...

data:                    # ② 数据字典（③ 数据模型）
  enums:
    - id: DocStatus
      name: 单据状态
      items:
        - { key: UNAUDIT, label: 未审批 }
        - { key: AUDITED, label: 已审批 }
  entities:
    - id: ProductCategory
      name: 产品分类
      fields:
        - { id: id, name: 主键, type: Integer, required: true }
        - { id: parentId, name: 父分类, type: Integer }
        - { id: name, name: 分类名称, type: String, required: true }
        - { id: status, name: 启用状态, type: ProductStatus, required: true }

modules:                 # ④ 模块 → ⑤ 功能 → ⑥ 页面（列/搜索/表单字段/按钮/动作）
  - id: product
    name: 产品管理
    functions:
      - id: erp-category
        name: 产品分类
        pages:
          - id: erpProductCategoryList     # 页面 id 必须与 TDSL page/dialog 名一致
            name: 产品分类列表
            kind: list                      # list | dialog-form | detail | dashboard
            entity: ProductCategory         # 对应 TDSL 实体
            query: queryErpProductCategory  # 列表取数 logic 名
            columns: [name, code, sort, status]
            search: [name, status]
            buttons:
              - { id: add, name: 新增分类, scope: page, action: { type: openDialog, target: erpProductCategoryForm } }
              - { id: edit, name: 编辑, scope: row, action: { type: openDialog, target: erpProductCategoryForm } }
              - { id: remove, name: 删除, scope: row, action: { type: logic, target: deleteErpProductCategory } }
          - id: erpProductCategoryForm
            name: 分类编辑
            kind: dialog-form
            entity: ProductCategory
            fields: [parentId, name, code, sort, status]
            buttons:
              - { id: save, name: 保存, scope: page, action: { type: logic, target: saveErpProductCategory } }
```

## 字段口径

| spec 写法 | 对应 TDSL |
|---|---|
| `kind: list` | `page XxxList`（@title/@menu） |
| `kind: dialog-form` | `dialog XxxForm` + `<form submit={useMutation('saveXxx')}>` |
| `kind: detail` | `dialog XxxDetail` + `<detail dataSource={useQuery('getXxx', initial.id)}>` |
| `action.type: logic` | `useMutation('目标', row.id)` |
| `action.type: openDialog` | `openDialog('目标', row)` |
| `button.scope: page/row` | 页面级按钮 / 表格行内按钮 |
| 按钮 `name` | 必须与 TDSL `<button text="...">` 一致（对照器按 text 匹配） |
| 枚举 label | TDSL enum `KEY('中文')`；需要颜色加第二参 |

## 对照器（check-spec）

```bash
tdsl check-spec <工程目录>    # 目录下须有 spec.yaml 与 tdsl/*.tdsl
```

- 五维对照：实体字段/枚举/页面/按钮/动作绑定，全 error 级；缺口非零退出码 1（可进 CI）。
- 退出码：0=零缺口；1=有缺口；2=spec/tdsl 读取或解析失败。
- 缺口清单直接就是"还没写的 TDSL"，按清单补齐再对照到 100%。
- spec 与 TDSL 改动**必须双向同步**：改需求先改 spec，改实现必须过对照。

## 完整参照

`../demo-yudao/spec.yaml`（1743 行，46 实体/79 页面/201 按钮）+ 同目录 8 个 tdsl 分片——spec 每一层都能在 TDSL 里找到对应物。