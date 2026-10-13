# 知乎推广文案（TDSL 首发）

> 用途：知乎专栏 / 回答 / 想法。正文可直接复制，`[图N]` 处插入截图或动图。
> 建议配图：① TDSL 源码与生成的双端工程对比图；② `tdsl check` 诊断截图；③ Playground 在线编辑动图；④ yudao 门户看板截图。

---

## 标题候选（选一）

1. 我做了一门「给 AI 写」的低代码 DSL：一份 TypeScript，编译出 Spring Boot + React 双端工程
2. 让 AI 写企业级 CRUD 不再白屏：TDSL，一门编译到 React + Java 的低代码 DSL
3. 为什么我们不再让大模型直接写前后端，而是让它写 TDSL

---

## 正文

### 一个所有用大模型写业务系统的人都踩过的坑

让 ChatGPT / Claude 帮你写一个「订单管理」——大概率跑不起来。不是模型不会写代码，而是：

- 前端和后端**各写一遍**，字段名、类型、接口路径对不上，联调半小时、白屏一整天；
- 没有类型约束，模型**自由发挥**，`status` 一会儿是字符串一会儿是枚举；
- 出错了没有**可被模型理解**的反馈，只能人肉 debug，模型改不动自己写的东西。

问题的根子在于：**你让模型去做一件没有"编译裁判"的事。**

如果有一种语言，写完能被**编译检查**，报错能**被模型读懂并自己改对**，通过后**自动产出前后端两套工程**——这一切就顺了。

这就是 **TDSL**。

[图1：TDSL 一句话定位图]

### TDSL 是什么

TDSL（Typed DSL）是一门**面向 Coding Agent 的低代码 DSL**：用类 TypeScript 的语法描述实体、接口、页面与业务逻辑，产出一棵类型化 AST，检查通过后生成 **Spring Boot + JPA** 与 **React + Ant Design** 两套可独立构建的工程。

它的三个关键选择：

1. **书写面就是 TypeScript。** 用大模型训练最充分、最直觉的语言建模，只引入极少量领域关键字（`entity` / `interface` / `page`）。模型几乎零学习成本。
2. **一份源码，双端产出。** 前后端同源生成，字段/类型/接口天然对齐，从根上消灭"联调对不上"。
3. **为 agent 而生。** 编译器返回**结构化诊断**（`[severity] [code] message (file:line:col) + 改成: suggestion`），模型能读、能定位、能自行修到 0 error。

### 一段 TDSL 长什么样

```ts
@datasource('defaultDS')

entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

@export
function listTodos(): List<Todo> {
  return Todo.all;
}

interface TodoApi {
  GET '/api/todos' -> listTodos
}

page TodoList {
  <table dataSource={useQuery('listTodos')}>
    <column field="title" />
  </table>
  <button text="新增" action={navigate('TodoCreate')} />
}
```

`tdsl generate` 之后，你会得到：一个带 JPA 实体/Repository/Controller 的 Spring Boot 工程，和一个带列表页、路由、接口封装的 React 工程。**你只写了一遍。**

[图2：左侧 TDSL 源码，右侧生成的双端工程目录树]

### 关键设计：编译器"零推断"，全部显式

工业级低代码最容易翻车的地方是"猜"。TDSL 的原则是**能显式就显式**：

- 外键必须写 `@ref(Supplier)` 才渲染引用下拉——字段名叫 `supplierId` **不算数**；
- 页面用到的函数**必须被 interface 端点暴露**，否则 typecheck 直接拦下（这条规则专门防前端白屏）；
- 枚举标签、颜色、按钮文案、操作反馈，全部写在 TDSL 里，**生成器只搬运不猜测**。

代价是多写几个字，收益是**行为可预测、报错可定位**。

### 实测：一个完整企业系统

我们用 TDSL 复刻了「芋道 ruoyi-vue-pro」的 ERP/CRM 子集：

- **46 个实体 / 79 个页面 / 201 个按钮**；
- `tdsl check` **0 问题**，spec 与实现对照**覆盖 100%**（1091 项）；
- **Java 与 React 双端真实构建通过**。

项目还配套一套 **Spec 先行**工作流：先写 `spec.yaml`（结构化需求），再落 TDSL，最后用 `check-spec` 自动对拍需求覆盖率——"写了没漏"这件事也交给编译器。这套方法在进销存、ERP 两个真实项目上都是 100% 覆盖交付。

[图3：yudao 门户看板 / 采购单列表截图]
[图4：`tdsl check-spec` 覆盖报告截图]

### 五分钟上手

```bash
npm i -g @tdsl/cli
tdsl check tdsl/                              # 编译与诊断
tdsl generate tdsl/ --name app -o generated   # 生成 Java + React
tdsl build tdsl/                              # 双端真实构建
```

给 AI Agent 的提示词也备好了——把下面这段丢给 Claude / GPT，它会读知识包、写 `.tdsl`、反复 `tdsl check` 修到 0 error：

```
请用 TDSL 开发这个应用：一门能编译出 React + Java 双端的低代码 DSL。
1. 安装 CLI：npm i -g @tdsl/cli
2. 读 agent 知识包 tdsl-skill/README.zh.md（语法 / fewshot 示例 / 错误码 / 真工程参照）。
3. 写 .tdsl 分片；每次改动后跑 `tdsl check <目录>`，按提示修到 0 error。
4. 需要产出工程：`tdsl generate <目录> --name app -o generated`。
```

### 资源

- GitHub：https://github.com/raindrop4steven/tdsl（求 star ⭐）
- 在线 Playground：https://raindrop4steven.github.io/tdsl/
- npm：`npm i -g @tdsl/cli`
- Agent 知识包：仓库内 `tdsl-skill/`（语法全书 / few-shot / 错误码 / 芋道真工程参照）

TDSL 还处在早期（0.0.x），API 与语法仍在演进。**欢迎拍砖、提 issue、PR，或者直接把你的业务需求丢给它试试。**

如果你也在做「让 AI 可靠地产出业务系统」这件事，评论区聊聊你的坑。

---

## 附：可直接发的「想法」短版

> 让大模型写业务系统，最大的坑不是它不会写，而是**没有编译器当裁判**：前后端各写一遍对不上、类型放飞、报错它改不懂。
>
> 我们做了一门 DSL（TDSL）：用 TypeScript 写实体/接口/页面，编译成 Spring Boot + React 双端，诊断结构化到 agent 能自己修到 0 error。
>
> 实测复刻芋道 ERP/CRM 子集：46 实体 / 79 页面 / 201 按钮，check 0 error、双端构建通过、spec 覆盖 100%。
>
> `npm i -g @tdsl/cli` 即可玩。开源：github.com/raindrop4steven/tdsl
>
> #低代码 #AI编程 #大模型 #开源
