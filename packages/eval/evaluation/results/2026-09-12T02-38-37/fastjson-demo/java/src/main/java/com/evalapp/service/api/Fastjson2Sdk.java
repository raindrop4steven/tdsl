package com.evalapp.service.api;

public interface Fastjson2Sdk {

  String toJSONString(Object o);

  Object parseObject(String json);
}
