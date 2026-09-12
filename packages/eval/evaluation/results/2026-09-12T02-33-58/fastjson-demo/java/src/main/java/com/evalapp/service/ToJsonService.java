package com.evalapp.service;

import org.springframework.stereotype.Service;
import com.alibaba.fastjson2.JSON;

@Service
public class ToJsonService {


  public ToJsonService() {

  }

  public String toJson(Object o) {
    return JSON.toJSONString(o);
  }
}
