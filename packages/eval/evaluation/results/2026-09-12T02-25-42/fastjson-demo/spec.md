系统：fastjson2 演示应用（fastjson2 是外部 jar，通过 FFI 目录已可直接调：com.alibaba.fastjson2.JSON 类提供 toJSONString(Object): String 与 parseObject(String): Object 静态方法；JSONObject 提供 getString/getInteger/containsKey）
要求（单文件 TDSL）：
- function toJson(o: Object): String —— 直接调 JSON.toJSONString
- function hasKey(json: String, key: String): Boolean —— parseObject 后调 containsKey
- interface FastjsonApi：POST '/api/to-json' -> toJson、POST '/api/has-key' -> hasKey