package com.evalapp.service;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import com.evalapp.service.api.*;

@Service
public class ToJsonService {

  @Autowired
  private Fastjson2Sdk fastjson2Sdk;

  public ToJsonService() {

  }

  public String toJson(Object o) {
    return fastjson2Sdk.toJSONString(o);
  }
}
