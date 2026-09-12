package com.evalapp.service;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import com.evalapp.service.api.*;

@Service
public class HasKeyService {

  @Autowired
  private Fastjson2Sdk fastjson2Sdk;

  public HasKeyService() {

  }

  public Boolean hasKey(String json, String key) {
    var obj = fastjson2Sdk.parseObject(json);
    return obj.containsKey(key);
  }
}
