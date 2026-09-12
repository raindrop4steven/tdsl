package com.evalapp;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 运行探针：runner 以 GET /healthz 判定后端就绪 */
@RestController
public class HealthController {

  @GetMapping("/healthz")
  public java.util.Map<String, Object> healthz() {
    return java.util.Map.of("ok", true);
  }
}
