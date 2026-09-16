# 需求分析：TDSL 能力范围实战验证（靶：芋道 ERP/CRM 子集）

> 里程碑归属：M3/M5 评测基准（AGENTS.md 中"评测基准 ✓/⬜"）。
> 目标：用一套真实企业级系统的结构化 Spec，把 **TDSL 能力范围**量出来——哪些功能点表达得了（绿）、哪些表达不了（缺口单）。
> 文档号：dev/39。状态：起草 → 待用户 Gate 确认。

## 1. 背景与动机

- 既有验证都是**自研 demo**（todo/jxc/todo-multi），Spec 也是自己编的，说服力有限。
- dev/35 已把 LLM 商用就绪优先级定出来，"编译器只做三件事"，其中"业务表达力"的量化标准需要一份**真实外部系统**作为压力靶。
- 京东级真实系统（芋道 ruoyi-vue-pro）官方文档自带**模块/功能/页面/表结构/按钮**描述，可复刻成 jxc 同构的六层 spec.yaml，直接复用 `examples/jxc/scripts/check-spec.ts` 对照器。

## 2. 靶系统选型（已定）

**芋道 ruoyi-vue-pro · ERP + CRM 子集**（doc.iocoder.cn 官方手册，管理后台在线 demo 可对照）：

| 子系统 | 选取模块 | 对应官方手册 | 模块内功能点（Runner 名单） |
|---|---|---|---|
| ERP | 产品管理 | /erp/product | 产品分类、产品单位、产品（物料） |
| ERP | 库存管理 | /erp/stock, /erp/stock-in-out, /erp/stock-move-check | 仓库、产品库存、库存明细、其它入库、其它出库、库存调拨、库存盘点 |
| ERP | 采购管理 | /erp/purchase | 采购订单、采购入库、采购退货、采购付款 |
| ERP | 销售管理 | /erp/sale | 销售订单、销售出库、销售退货、销售收款 |
| ERP | 财务管理 | /sale/finance-payment-receipt | 结算账户、采购付款单、销售收款单 |
| CRM | 线索/客户 | /crm/clue, /crm/customer | 线索管理、客户管理、公海客户、客户限制配置、客户公海配置、联系人 |
| CRM | 商机/合同 | /crm/business, /crm/contract | 商机管理、商机状态、合同管理、合同提醒 |
| CRM | 回款/产品/通用 | /crm/receivable, /crm/product, /crm/follow-up | 回款管理、回款计划、CRM 产品/分类、跟进记录、待办事项 |

**不做**（第一靶剥离，避免目标发散）：移动端 uni-app、工作流审批流、数据权限/多租户 Saas、Excel 导入导出、报表大屏、消息队列/定时任务等基础设施，以及非管理端的 C 端商城/会员。

## 3. 功能点列表（第一靶验收）

按 jxc `spec.yaml` 六层结构（system → data[enum+entity] → module → function → page → button）逐条落盘。数量预估：

- 枚举：ERP `erp_stock_record.biz_type`（业务类型 10+ 值）、`status` 采购/销售状态、CRM `deal_status/lock_status/follow_up_status` 等多态枚举
- 实体：~22+ 张表（采购订单+明细、入库+明细、退货+明细、付款单+明细、收款单+明细、产品/分类/单位、仓库/库存/库存明细、线索、客户、联系人、商机、合同、回款、CRM 产品…）
- 页面：30+（列表/编辑/详情），其中含主子表单、树形分类（产品分类/CRM 产品分类无限层级）、行内状态流转、公海领取/分配、回款计划等非纯 CRUD 形态
- 按钮：100+（审批/反审批、放入公海、领取/分配、成交/锁定、跟单、转商机、作废…）

**能力域映射**（预估勘探点，编码时逐条核验）：

| 能力域 | 代表功能点 | TDSL 现状预判 |
|---|---|---|
| 实体/枚举建模 | 主子表、树形分类、Decimal(24,6) 金额/数量 | 已支持子实体/Decimal；树需 `parentId` 自引用核实 |
| 查询 | 多条件复合 where、orderBy/page | 已支持；需核实跨实体 join（订单带客户名） |
| 聚合统计 | 库存汇总、回款统计 | where/aggregate 已支持，groupBy 需核实 |
| 复杂逻辑 | 审批→库存联动+库存明细、回款核销已收/应收、金额税价合计 | 表达式域核心，需实测链/分支/集合 |
| 页面 | 主子表编辑、树形选择器、状态流转按钮、行选择器 | M4 已验证 list/form/dialog；树/表格子表/复杂组件需核实 |
| 事务一致性 | 采购入库同时改库存与明细（@Transactional） | 方法级已支持，需确保跨实体写同一事务 |
| 鉴权能力 | 按钮级权限、数据范围 | 明确缺口（TDSL 无权限体系）——只记录不实现，入缺口单 |
| 外部依赖 | 结算账户、单位、分类等主数据引用 | 实体外键引用已支持 |

## 4. 工作量与方法（管线）

```
1. 从官方手册抽取 → examples/yudao/spec.yaml（六层，照 jxc 格式）
2. LLM/人 按 spec 编写 TDSL → examples/yudao/tdsl/*.tdsl（分片：00-model / 10-product / 20-stock / 30-purchase / 40-sale / 50-finance / 60-crm）
3. tdsl check（含 typecheck）→ 0 error 收敛
4. check-spec 对照 → 覆盖率报告（5 维：实体字段/枚举/页面/按钮/动作绑定）
5. 能力范围缺口清单 → docs/dev/40_验收报告-TDSL能力范围验证-芋道.md
   - 结论分四档：✅ 全覆盖 / 🟡 覆盖但需绕路 / 🟠 部分（记录表现 X%）/ ❌ 缺口（进缺口单，标注影响）
```

## 5. 验收标准

1. `examples/yudao/spec.yaml` 落盘（枚举/实体/页面/按钮齐全），对照器可解析
2. `tdsl check examples/yudao/tdsl` 0 error（typecheck 收敛，宽松放行策略下"判不出不报错"）
3. `check-spec` 跑通输出覆盖度：实体字段≥90%、页面 100%、按钮≥80%（首批容忍缺口，目标是把缺口量化成清单）
4. 产出缺口清单，每条含：功能点、Spec 出处（模块/页面/按钮）、缺口类型（语言缺失/语义缺失/生成器缺失）、影响面、建议（进 dev/35 或 M3）

## 6. 影响与依赖

- 复用 `check-spec.ts`（可能小改：支持树形 kind `tree-list`、`subform`、`detail`，禁止破坏 jxc 既有对照）
- 纯新增目录 `examples/yudao/`，不进 npm workspace（照 jxc 惯例，独立 npm run）
- 不动编译器现有行为；若发现真缺陷，走 dev/38 的 F-层诊断规则修补流程
- 文档链：dev/39（本文）→ dev/40（验收报告）→ docs/index.html 同步 → memory.md 追加

## 7. 风险

- 芋道表带 creator/deleted/tenant_id 等通用字段——Spec 裁剪掉，只保留业务字段（与 jxc 一致）
- decimal(24,6) 大量金额/数量/税率精度——TDSL Decimal 语义需确认 scale 表达
- `biz_type` 多态业务绑定（库存明细挂多个单型）——探测 TDSL 多态表达力，判不出则记录
- 页面形态多（树/主子表/行状态/选择器）——enabler 组件缺失记为生成器缺口