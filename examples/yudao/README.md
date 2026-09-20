# yudao —— TDSL 能力验证样例（芋道 ERP/CRM 子集）

用真实企业系统（芋道 [ruoyi-vue-pro](https://doc.iocoder.cn/) 的 ERP + CRM 子集）验证 TDSL 的表达力与生成力：
**一份 TDSL → 编译裁判 → 生成 Java 后端（Spring Boot + JPA + MySQL）+ React 前端（Vite + antd）→ 真机跑通**。

```
tdsl/*.tdsl ──parse+typecheck──▶ Typed AST ──codegen──▶ generated/java（Spring Boot）
   （9 个分片）      （tdsl check）      （SSoT）        └─▶ generated/react（Vite + antd）
```

---

## 一键演示（推荐）

```bash
npm install          # 仓库根：建立 workspaces 链接（含编译器 @tdsl/cli）
cd examples/yudao
npm run demo        # 生成双端代码 → 起后端(:8080) → 灌演示数据 → 起前端(:5173)
```
（也可以从仓库根直接 `npm run demo:yudao`）

### 换到新环境（编译器独立安装，不含本仓库）

demo 的脚本只依赖 **`tdsl` 命令**（来自 `@tdsl/cli`），与仓库目录结构无关：

```bash
# 1) 打包编译器为独立 npm 包（本仓库执行；产物 npm-dist/*.tgz，只含压缩 JS 无 TS 源码）
npm run pack:compiler

# 2) 新目录：拷贝本样例的 tdsl/ spec.yaml scripts/ package.json，安装编译器
mkdir my-yudao && cd my-yudao
cp -r <仓库>/examples/yudao/{tdsl,spec.yaml,scripts,package.json} .
npm i -D <仓库>/npm-dist/tdsl-*.tgz        # 或发布私服后：npm i -D @tdsl/cli

# 3) 同样一键
npm run demo
```

> `TDSL_CLI` 环境变量可指定编译器命令（如全局安装的 `tdsl`）。

完成后打开 **http://localhost:5173**；停止：

```bash
npm run stop
```

`demo.sh` 做的事（5 步）：

| 步骤 | 动作 |
|------|------|
| 1 | `tdsl check tdsl`（编译裁判：0 问题才继续）→ `tdsl generate tdsl --name yudao -o generated`（Java + React 双端） |
| 2 | 启动后端 `npm run backend`（Spring Boot + **MySQL 库 `erp`**，见下「数据库」；`ddl-auto` 启动时建表），等 `/healthz` 就绪 |
| 3 | `tsx scripts/seed.ts` 灌演示数据（产品/库存/采购/销售/财务/CRM 全链路，105 条请求） |
| 4 | 启动前端 `npm run dev`（Vite，`/api` 代理到 8080） |
| 5 | 打印地址与演示动线 |

> MySQL 是持久库：**数据重启不丢**。要重来一遍，先清库再重跑 `npm run demo`（详见下）。

---

## 数据库（MySQL）

生成工程默认连本机 MySQL：`localhost:3306/erp`，账号 `root` / `123456`。表由 JPA `ddl-auto: update` 在后端启动时自动建好；演示数据由 `npm run seed` 经 REST 灌入。

连接参数可用环境变量覆盖（`npm run backend` 已把下列默认值注入）：

| 环境变量 | 默认值 |
|----------|--------|
| `TDSL_DB_URL` | `jdbc:mysql://localhost:3306/erp?createDatabaseIfNotExist=true&useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai` |
| `TDSL_DB_USER` | `root` |
| `TDSL_DB_PASSWORD` | `123456` |
| `TDSL_BACKEND_PORT` | `8080` |

> 生成器本身与数据库无关：`application.yml` 里连接是环境变量占位（缺省回落到 H2 内存库），pom 同时带 H2 与 MySQL 驱动；本项目只是通过 `scripts/backend.ts` 把 MySQL 三件套注入进程环境。

清库重灌（只删本应用的表，不动库内其他表）：

```bash
mysql -h127.0.0.1 -uroot -p123456 -e "DROP DATABASE erp;"
# 或保留库只清表：逐个 DROP TABLE；重启后端会自动重建
npm run demo
```

## 登录与鉴权（M11）

- 打开前端**先到登录页**（布局外全屏企业风）→「注册」或用 seed 预置的 **admin / 123456** 登录；
- 登录后右上角显示当前用户 + 退出；未登录访问任意业务页会被路由守卫拦回登录页；
- **所有 `/api/**`（除 `/api/auth/**`、`/healthz`）要求 Bearer token**，前端由 `src/auth.ts` 统一注入、后端由 `AuthInterceptor` 校验（无效/过期 → 401 → 前端自动清会话回登录页）；
- 密码加盐哈希（SHA-256 + 用户名盐）落库，不明文。

---

## 分步命令（想看清每一步）

```bash
# 1) 编译校验（读 tdsl/ 全部分片，输出人话诊断）
node ../../packages/cli/bin/tdsl.mjs check tdsl

# 2) 生成双端代码到 generated/{java,react}（可 --java / --react 只生成一端）
npm run gen

# 3) 真实构建（mvn compile + vite build）
npm run build:java
npm run build:react

# 4) 起后端（:8080）与前端（:5173），各开一个终端
npm run backend
npm run frontend

# 5) 灌演示数据（后端起来后执行）
npm run seed
```

对比 Spec 覆盖度（对照 `spec.yaml` 六层需求，五维 1091 项）：

```bash
npm run check-spec
```

---

## 目录说明

```
examples/yudao/
├─ tdsl/                 # ★ TDSL 源码（唯一事实来源）
│  ├─ 00-model.tdsl      #   实体/枚举/结构体（@ref 外键全部显式声明）
│  ├─ 05-portal.tdsl     #   门户看板（统计/轮播/进度/列表 + 聚合查询逻辑）
│  ├─ 10-product.tdsl    #   产品/分类/单位/供应商/客户
│  ├─ 20-stock.tdsl      #   仓库/库存/库存流水/盘点（applyStock 联动入口）
│  ├─ 30-purchase.tdsl   #   采购订单/入库/退货/付款（审批 → 库存+订单回写+核销）
│  ├─ 40-sale.tdsl       #   销售订单/出库/退货/收款
│  ├─ 50-finance.tdsl    #   结算账户
│  └─ 60-crm.tdsl        #   线索/客户/联系人/商机/合同/回款/待办（含公海规则）
├─ spec.yaml             # 结构化需求（六层：数据/枚举/页面/按钮/动作），check-spec 的对照基准
├─ scripts/
│  ├─ demo.sh / stop.sh  # 一键演示 / 停止
│  ├─ seed.ts            # 演示数据灌入（HTTP 调用生成的后端）
│  ├─ seed-stock-checks.ts
│  └─ check-spec.ts      # Spec 覆盖度对照器
└─ generated/            # ★ 产物（generate 生成，独立构建；不进 npm workspace）
   ├─ java/              #   Spring Boot 工程（pom.xml + src/main/java）
   └─ react/             #   Vite + React 工程（src/pages 每页一个文件）
```

---

## 生成物是什么样

- **后端**：`@Entity`/`Repository`（查询链生成 `@Query` JPQL，命名参数、null 宽松）/`Service`（业务逻辑 + `@Transactional`）/`Controller`（interface 端点 → REST）/**建表由 JPA `ddl-auto` 自动完成**，无需 DDL（也可用生成的 `db/schema.sql` 交付建库）。
- **前端**：每页一个 `.tsx`（antd 表格/表单/抽屉），列表列自动识别枚举（中文 Tag，颜色由 enum 声明）/外键（显示引用名）/分页；表单按字段类型升级控件；`@ref` 字段出下拉；`visible/disabled` 控制按钮可用性；`@ok` 文案驱动操作成功提示。
- **门户**：`statistic` 绑聚合查询（`where(...).aggregate(count())`）、轮播、进度、只读列表。

## 演示动线（建议）

1. **门户**：经营总览 → 指标卡 / 轮播 / 近期列表
2. **采购入库**：未审批行只剩「审批」→ 点审批 → 库存 + 流水 + 订单 `inCount` 回写（打开订单详情看）→ 已审批行只剩「反审批」且「编辑」置灰
3. **销售出库**：审批时库存不足会被拦截并**回滚**（业务错误弹窗）
4. **客户列表**：公海客户可「领取」（写负责人+时间戳）、已锁定客户「编辑」置灰、重复领取报错
5. **详情 → 编辑**：抽屉里点编辑，表头字段与明细行都会带出

## 另：在线生成（Agent 形态）

不想手写 TDSL，可走仓库根的在线 Agent（聊天提需求 → 自动写分片 → 编译自修 → 生成 → 起服务 → 导出 zip）：

```bash
cd ../..
npm run server        # http://localhost:8787
```
