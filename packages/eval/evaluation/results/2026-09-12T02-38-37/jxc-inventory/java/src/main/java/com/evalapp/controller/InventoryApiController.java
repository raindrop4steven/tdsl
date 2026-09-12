package com.evalapp.controller;

import org.springframework.web.bind.annotation.*;
import com.evalapp.service.*;
import com.evalapp.entity.*;
@RestController
@CrossOrigin(origins = "*")
public class InventoryApiController {
  private final InventorySummaryService inventorySummaryService;

  public InventoryApiController(InventorySummaryService inventorySummaryService) {
    this.inventorySummaryService = inventorySummaryService;
  }

  @GetMapping("/api/inventory/summary")
  public java.util.List<Goods> inventorySummary(@RequestParam(value = "goodsCode", required = false, defaultValue = "") String goodsCode) {
    return inventorySummaryService.inventorySummary(goodsCode);
  }
}
