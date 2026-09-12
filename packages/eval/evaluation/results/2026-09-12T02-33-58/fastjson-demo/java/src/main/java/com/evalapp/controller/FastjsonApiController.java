package com.evalapp.controller;

import org.springframework.web.bind.annotation.*;
import com.evalapp.service.*;
@RestController
@CrossOrigin(origins = "*")
public class FastjsonApiController {
  private final ToJsonService toJsonService;
  private final HasKeyService hasKeyService;

  public FastjsonApiController(ToJsonService toJsonService, HasKeyService hasKeyService) {
    this.toJsonService = toJsonService;
    this.hasKeyService = hasKeyService;
  }

  @PostMapping("/api/to-json")
  public String toJson(@RequestBody Object o) {
    return toJsonService.toJson(o);
  }

  @PostMapping("/api/has-key")
  public Boolean hasKey(@RequestBody String json, @RequestBody String key) {
    return hasKeyService.hasKey(json, key);
  }
}
