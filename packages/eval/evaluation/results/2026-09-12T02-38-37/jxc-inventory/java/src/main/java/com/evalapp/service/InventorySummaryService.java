package com.evalapp.service;

import org.springframework.stereotype.Service;
import com.evalapp.entity.*;
import com.evalapp.repository.*;

@Service
public class InventorySummaryService {
  private final GoodsRepository goodsRepository;

  public InventorySummaryService(GoodsRepository goodsRepository) {
    this.goodsRepository = goodsRepository;
  }

  public java.util.List<Goods> inventorySummary(String goodsCode) {
    if ((goodsCode == null)) {
    return goodsRepository.findAll();
    }
    return goodsRepository.findByGoodsCodeLike((("%" + goodsCode) + "%"));
  }
}
