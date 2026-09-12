package com.evalapp.service;

import org.springframework.stereotype.Service;
import com.alibaba.fastjson2.JSON;

@Service
public class HasKeyService {


  public HasKeyService() {

  }

  public Boolean hasKey(String json, String key) {
    var obj = JSON.parseObject(json);
    return obj.containsKey(key);
  }
}
