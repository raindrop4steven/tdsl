# 48 · 详细设计 — ERP 门户看板与角色视角（逻辑设计）

> 状态：⏸ 待用户 Gate 确认（阶段三·详细设计）
> 日期：2026-09-16
> 关联：dev/46（需求）、dev/47（系统设计）

## 0. 范围修正（相对 dev/46/47）

**新增 F2b：补齐 C1 表达力缺口 `where(...).aggregate(...)`**（dev/21 记录的历史缺口）。
理由：门户核心指标（待审批单数、低库存品类数、未成交商机数）都是**条件聚合**；当前 TDSL 只支持无条件 `X.aggregate(...)`（实测 `Order.where(...).aggregate(count())` 报"查询链无方法 aggregate"）。不补则门户只能显示"全量计数"，失去业务含义。
改动收敛（实测确认）：`QuerySpec` 已有 `conditions + aggregate` 结构，只需 java 端聚合分支补 WHERE、typecheck 链白名单放行，**react 端零改动**（标量 `number`）。

**F2a 范围确认**：仅标量聚合（`count()/sum(x)/avg/max/min`）进指标卡；`groupBy` 的 `List<Map>` 渲染不做。

## 1. 语言与编译链

### 1.1 parser：`@role` 注解（~4 行）

`parser.ts` 顶层注解分支（`@title/@menu` 同处）：

```ts
} else if (ann === 'title' || ann === 'menu' || ann === 'role') {
  this.expect('(');
  pendingViewAnnos.set(ann, this.expectString());
  this.expect(')');
}
```

`@role('老板,采购员')` 原样进 `view.annotations`（逗号分隔，读取侧拆分）。

### 1.2 typecheck

- `KNOWN_VIEW_TYPES` 增：`row`、`col`、`carousel`、`item`、`list`；
- **C1 链放宽**：
  - `CHAIN_METHODS` 增 `aggregate`（使其可作为 `where(...)` 的后续链）；
  - `checkChainMethod('aggregate')`：仅允许出现在 `where(...)` 之后（`orderBy/page/limit/groupBy` 之后不允许）；参数校验复用 `extractAggregate` 白名单（fn ∈ count/sum/avg/max/min，sum/avg/max/min 需字段、count 可无参）；
  - `entityQueryChainOf`：沿链向上识别 `aggregate`；
  - 结果类型：`where(...).aggregate(...)` → 标量（`Integer`/`Decimal`，与 `X.aggregate(...)` 一致）。

### 1.3 codegen-java：条件聚合 JPQL

`repoMethod` 聚合分支：当 `spec.conditions.length > 0` 时拼 `WHERE`（复用 null 宽松谓词与 named 参数）：

```java
@Query("SELECT SUM(o.total) FROM Order o WHERE (:status IS NULL OR o.status = :status)")
BigDecimal sumTotalByStatus(@Param("status") String status);
```

- 方法名：`${fn}${cap(field)}By${cap(cond.field)...}`（与派生命名一致，去重由既有 `collectQuerySpecs` 处理）；
- 返回类型：既有 `agg.ret`（`sum/avg/max/min` → 字段 Java 类型/nullable 包装；`count` → `Long`）；
- 无数据时返回 `null` → 前端 `Number(data ?? 0)` 兜住。

### 1.4 codegen-react：组件映射

| DSL | 生成物（要点） |
|-----|----------------|
| `<row gutter=16>` | `<Row gutter={16} style={{ marginBottom: 16 }}>…</Row>` |
| `<col span={6}>` | `<Col span={6}>…</Col>`（缺省 12） |
| `<carousel autoplay={true}>` + `<item title text>` | `<Carousel autoplay><div style={{ padding: 24, background: '#e6f4ff', borderRadius: 6 }}><h3>title</h3><div>text</div></div>…</Carousel>` |
| `<list dataSource={useQuery('x')}>` + `<item field title>` | `<List size="small" bordered dataSource={q.data ?? []} renderItem={(it) => (<List.Item><span style={{marginRight:16}}>title：{it.field}</span>…</List.Item>)} />` |
| `<statistic title dataSource={useQuery('x')} />` | `<Statistic title="…" value={Number(qX.data ?? 0)} />`（无 dataSource 时沿用 `value={表达式}`） |

- `item` 按父元素分派（carousel 幻灯片 / list 行模板）；
- list 行的外键字段：若该字段能解析出 FkRef（显式 @ref 或推断）→ `{String((qFkX.data ?? []).find(o=>o.id===it.field)?.name ?? it.field)}`；枚举 → 原值（文档注明）；
- import 收集：`ANTD_OF` 增 `row→Row / col→Col / carousel→Carousel / list→List`（`item` 不映射，由父渲染）。

### 1.5 codegen-react：角色过滤与切换器（App.tsx）

```tsx
const ROLE_KEY = 'tdsl-role';
const ROLES: string[] = [...];                     // 由带 @role 的页面去重稳定排序（空则不生成切换器）
const PAGE_ROLES: Record<string, string[]> = { '/boss-dashboard': ['老板'], ... };

const [role, setRole] = useState<string>(() => localStorage.getItem(ROLE_KEY) ?? ROLES[0] ?? '');
useEffect(() => { localStorage.setItem(ROLE_KEY, role); }, [role]);
const visible = (key: string): boolean => { const rs = PAGE_ROLES[key]; return !rs || rs.includes(role); };
```

- Header 右侧 `ROLES.length > 0` 时渲染：`<Select size="small" value={role} onChange={setRole} options={ROLES.map(r=>({label:r,value:r}))} />` + 文案 `演示级角色切换（无鉴权）`；
- `MENU_ITEMS`：生成期按 **静态可见集合** 不变，运行期过滤 —— 菜单项改为 `{ key, label }` + 运行期 `.filter(i => visible(i.key))`；分组菜单过滤后为空则丢弃该组；
- `Routes`：`{visible('/x') && <Route … />}`（防手输 URL）；
- **无 `@role` 的应用**：`ROLES = []`、`PAGE_ROLES = {}`、`visible` 恒 true、不渲染切换器 → 生成结果与现状**逐字节一致**（仅多一层恒真过滤，注释说明）。

## 2. yudao 样例

### 2.1 统计 logic（走 C1 条件聚合）

| 函数 | 签名 | 实现要点 |
|------|------|----------|
| `countErpPurchaseOrder` | `(): Integer` | `PurchaseOrder.aggregate(count())` |
| `countErpPurchaseInPending` | `(): Integer` | `PurchaseIn.where(status = DocStatus.UNAUDIT).aggregate(count())` |
| `sumErpStockCount` | `(): Decimal` | `Stock.aggregate(sum(count))` |
| `sumErpSaleAmount` | `(): Decimal` | `SaleOrder.aggregate(sum(totalPrice))` |
| `countErpSaleOutPending` | `(): Integer` | `SaleOut.where(status = DocStatus.UNAUDIT).aggregate(count())` |
| `sumErpReceiptPending` | `(): Decimal` | `SaleOut.aggregate(sum(receiptPrice))`（口径：已收合计） |
| `countCrmClue` / `countCrmCustomer` | `(): Integer` | 全量 `aggregate(count())` |
| `countCrmBusinessOpen` | `(): Integer` | `CrmBusiness.where(endStatus = null?)` → 用 `dealStatus`/`statusId` 可判条件；实现取 `CrmBusiness.where(followUpStatus = FollowUpStatus.FOLLOWED).aggregate(count())` 作演示 |
| `countCrmReceivablePending` | `(): Integer` | `CrmReceivable.where(auditStatus = CrmAuditStatus.UNSUBMIT).aggregate(count())` |

全部 `@export` + interface 端点（`GET /api/.../stats/...`）。

### 2.2 门户页面（5 个，`kind: dashboard`）

```tdsl
@role('老板') @title('经营总览') @menu('门户')
page bossDashboard {
  <row>
    <col span={6}><statistic title="本月销售额" dataSource={useQuery('sumErpSaleAmount')} /></col>
    <col span={6}><statistic title="采购订单数" dataSource={useQuery('countErpPurchaseOrder')} /></col>
    <col span={6}><statistic title="库存总量"   dataSource={useQuery('sumErpStockCount')} /></col>
    <col span={6}><statistic title="待审批入库" dataSource={useQuery('countErpPurchaseInPending')} /></col>
  </row>
  <carousel autoplay={true}>
    <item title="九月采购节" text="办公设备满 10 万返 5%……" />
    <item title="库存盘点通知" text="9/30 前完成华东仓盘点" />
    <item title="新品上架" text="联想拯救者 Y9000P 已入库" />
  </carousel>
  <row>
    <col span={12}><list dataSource={useQuery('queryErpPurchaseIn')} title="近期入库">…</list></col>
    <col span={12}><list dataSource={useQuery('queryErpSaleOrder')} title="近期销售">…</list></col>
  </row>
}
```

同款构造：`purchasePortal`（采购员）/`salePortal`（销售员）/`stockPortal`（仓管）/`crmPortal`（销售员）。

### 2.3 spec / check-spec

- `spec.yaml`：新增 `function: dashboard`（或将门户归入对应模块 functions 下），页面 `kind: dashboard`；
- `check-spec.ts`：`wantKind` 计算增 `page.kind === 'dashboard' ? 'page' : …`；dashboard 页不校验 columns/search/subform（仅页面存在 + 按钮）；
- 角色维度不入 spec（记录理由：演示级前端过滤）。

## 3. 测试矩阵

| # | 层 | 用例 |
|---|----|------|
| T1 | parser | `@role('A,B')` 进 annotations；无 `@role` 不产注解 |
| T2 | typecheck | 新组件已知；`where(...).aggregate(count())` 通过；`aggregate` 出现在 orderBy 后报错；`statistic dataSource` 未 expose 报错 |
| T3 | codegen-java | 条件聚合 JPQL（`WHERE` + named 参数）；无条件聚合回归 |
| T4 | codegen-react | Row/Col、Carousel+item、List+item、statistic 绑查询；角色过滤（菜单/路由）、切换器与 localStorage；无 `@role` 应用不生成切换器且输出不变 |
| T5 | 端到端 | yudao：check 0 问题、聚合接口真机返回数值、5 门户渲染、切角色菜单变化 |
| T6 | 回归 | 全仓单测绿；jxc/todo/todo-multi 生成不变；check-spec 不回归 |

## 4. 文件清单

| 文件 | 动作 |
|------|------|
| `packages/parser/src/parser.ts` | `@role` 注解（4 行） |
| `packages/typecheck/src/index.ts` | 组件白名单 + C1 链放宽 |
| `packages/codegen-java/src/index.ts` | 条件聚合 JPQL（聚合分支拼 WHERE） |
| `packages/codegen-react/src/index.ts` | 组件映射 + statistic + 角色过滤/切换器 |
| 三包 test | 用例（T1–T4） |
| `examples/yudao/tdsl/70-portal.tdsl`（新）+ interface 端点 | 5 门户 + 统计 logic |
| `examples/yudao/spec.yaml`、`scripts/check-spec.ts` | dashboard 维度映射 |

## 5. 错误与边界

| 情形 | 行为 |
|------|------|
| 无数据聚合 | SQL 返回 null → `Number(data ?? 0)` 显示 0 |
| `@role` 写了但无匹配角色 | 该页对任何角色不可见（切换器仍列出角色）→ 文档提示 |
| `aggregate` 非法位置（如 `X.aggregate().where()`） | typecheck 报"aggregate 仅可用于 where(...) 之后" |
| 老应用无 `@role` | 不生成角色逻辑，菜单/路由过滤恒真，输出与现状一致 |
| `list` 无 `item` 子元素 | 生成空列表壳（宽松；文档建议至少一个 `<item>`） |

## 6. 范围修正（用户实测反馈，同日）

| 项 | 决定 | 说明 |
|----|------|------|
| 角色切换 | **去掉** | 用户明确不要演示级切换器。`@role` 语法解析保留（语言面），但外壳**不再生成**角色表/过滤/切换器；yudao 门户去掉 `@role`，改为全员可见 |
| 门户排版 | 轮播置顶、去公告条 | `alert` 组件保留（语言面），yudao 门户不再使用；轮播作为首屏 Banner |
| 指标卡样式 | 左侧色条 + 浅色渐变 + 大号彩色数字（26px） | `statistic` 支持 `color`（颜色名/#hex）与 `suffix`（单位） |
| 轮播样式 | 渐变 Banner（160px、白字、装饰圆） | 按序取品牌色（blue/green/orange/purple） |
| 列表样式 | 卡片 + `List.Item.Meta`（首项主标题 / 其余次要行 / `extra={true}` 右侧强调值）+ **每页 5 条分页** | `list` 新增 `primary` / `extra` 标记 |
| 列表枚举 | 渲染**中文 Tag**（原样输出 `UNFOLLOWED` 的问题修复） | `listItemValueJsx` 命中枚举 → Tag + label 映射 |
| 文本转义 | 生成的 JSX 对 `< > { } &` 做转义 | 修「退货率（目标 <5%）」截断标签的缺陷 |
| 栅格对齐 | `Row gutter={[16,16]}`；`Col` 纵向 flex；卡 `flex:1` | 同行卡片等高、纵向留白一致 |

## 7. 阶段五·实测（门户）

- 16 个 `GET /api/portal/stats/*` 全部 200：purchase-orders=3、purchase-in-pending=1、purchase-return-pending=1、purchase-amount=395730、stock-count=4700、sale-amount=147425、sale-out-pending=1、sale-out-receipt=48920、product-count=7、warehouse-count=2、crm-clues=2、crm-customers=4、crm-customers-locked=0、crm-businesses=2、crm-contracts=1、crm-receivable-pending=0
  - **排查记录**：首次报 404 是**运行中的后端未重启**（新统计逻辑已重新生成但进程是旧的）——重启即恢复，非代码缺陷
- 前端：react tsc / vite build ✓；vite 代理下同接口 200 ✓
