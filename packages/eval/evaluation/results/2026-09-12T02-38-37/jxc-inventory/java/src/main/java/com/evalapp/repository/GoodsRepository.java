package com.evalapp.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import com.evalapp.entity.Goods;
public interface GoodsRepository extends JpaRepository<Goods, Long> {

  @org.springframework.data.jpa.repository.Query("SELECT g FROM Goods g WHERE (?1 IS NULL OR g.goodsCode LIKE CONCAT('%', ?1, '%'))")
  java.util.List<Goods> findByGoodsCodeLike(String goodsCode);
}
