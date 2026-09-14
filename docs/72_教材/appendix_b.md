# 附录 B. 类型层级图

TDSL 类型系统的层次结构，以及 DSL 类型 → Java/React 类型的映射全景。

## B.1 类型层级

```
                    Any（顶层类型：所有类型的超类型）
                      │
     ┌────────┬───────┼────────┬────────┬─────────┐
   String  Integer  Decimal  Boolean  Date    DateTime  List<T>  Reference
     └────────┴───────┴────────┴────────┴─────────┴───┬────┘
                                                      │
                                                   Null（底层类型：所有类型的子类型）
```

- **Any**：所有类型的超类型。对应内建 `Object` 引用。
- **Null**：所有类型的子类型。`null` 字面量可出现在任何类型期望的位置。
- **隐式转换**（单向）：`Integer → Decimal`。整数值可隐式提升为 Decimal，反方向不允许（可能丢失小数）。
- **泛型参数**：`List<T>`、`Map<K,V>`、`Page<T>` 是参数化类型，`T` 可为任意 TypeRef。
- **Decimal(p,s)**：`db` 形态的 TypeRef，携带精度 `p` 和标度 `s`，是 Decimal 的"带精度变体"。

## B.2 DSL 类型 → Java 类型映射

| TDSL |> Java（field） | Java（方法参数） | 说明 |
|------|------|------|------|
| `String` | `String` | 直接对应 |
| `Integer` | `Long` | 64 位防溢出 |
| `Decimal` / `Decimal(p,s)` | `java.math.BigDecimal` | 精确十进制 |
| `Boolean` | `Boolean` | 直接对应 |
| `Date` | `java.time.LocalDate` | 无时区日期 |
| `Time` | `java.time.LocalTime` | 无时区时间 |
| `DateTime` | `java.time.ZonedDateTime` | 携带时区 |
| `List<T>` | `java.util.List<...>` | 泛型展开 |
| `Map<K,V>` | `java.util.Map<String, ...>` | 键固定 String |
| `Page<T>` | `org.springframework.data.domain.Page<...>` | Spring Data |
| 实体/结构引用 | `<EntityName>` | 简名 + import |

> 真实代码的一处不一致：`type-map.ts` 把基元 `DateTime` 映射为 `java.time.ZonedDateTime`（携带时区语义），而 FFI 内核域 `DateTime`（`stdlib.ts`）用的是 `java.time.LocalDateTime`。两种映射各自有其历史理由，但对同一别名并存两个 Java 类是不完美的——教材里这类"同别名双映射"值得留意，说明编译器演进中不同子系统的约定可能漂移。

## B.3 DSL 类型 → React/JS 映射

| TDSL | JS | 说明 |
|------|-----|------|
| `String` | `string` | 直接对应 |
| `Integer` | `number` | JS 统一 number |
| `Decimal` / `Decimal(p,s)` | `number` | 前端算术走 number |
| `Boolean` | `boolean` | 直接对应 |
| `Date`/`Time`/`DateTime` | `string` | 字符串序列化 |
| `List<T>` | `T[]` | 原生数组 |
| `Map<K,V>` | `Record<K,V>` | 对象 |
| `Page<T>` | `T[]` | 前端取 content 数组 |
| 实体/结构引用 | 接口类型 | TS 接口 |

## B.4 内建类型成员速览（FFI 内核五域）

| 域 | DSL 别名 | Java 类 | 双端 | 代表性成员 |
|----|---------|---------|------|-----------|
| String | `String` | `java.lang.String` | ✓ | trim / toUpperCase / contains / isEmpty / length |
| Decimal | `Decimal` | `java.math.BigDecimal` | 后端 | add / subtract / multiply / abs / min / max |
| Date | `Date` | `java.time.LocalDate` | 后端 | now / plusDays / isBefore / getYear |
| DateTime | `DateTime` | `java.time.LocalDateTime` | 后端 | now / plusDays / plusHours / isAfter |
| List | `List` | `java.util.List` | ✓ | add / count / contains / isEmpty / get |