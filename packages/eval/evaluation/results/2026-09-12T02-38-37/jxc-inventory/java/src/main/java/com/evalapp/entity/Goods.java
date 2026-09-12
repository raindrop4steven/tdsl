package com.evalapp.entity;

import javax.persistence.*;
@Entity
@Table(name = "goods")
public class Goods {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  private String goodsCode;

  private String goodsName;

  private String category;

  private String spec;

  private String unit;

  private java.math.BigDecimal safetyStock;

  private java.math.BigDecimal inQty;

  private java.math.BigDecimal inRetQty;

  private java.math.BigDecimal outQty;

  private java.math.BigDecimal outRetQty;

  private java.math.BigDecimal stock;

  public Goods() {
  }

  public Long getId() { return id; }

  public void setId(Long id) { this.id = id; }

  public String getGoodsCode() { return goodsCode; }

  public void setGoodsCode(String goodsCode) { this.goodsCode = goodsCode; }

  public String getGoodsName() { return goodsName; }

  public void setGoodsName(String goodsName) { this.goodsName = goodsName; }

  public String getCategory() { return category; }

  public void setCategory(String category) { this.category = category; }

  public String getSpec() { return spec; }

  public void setSpec(String spec) { this.spec = spec; }

  public String getUnit() { return unit; }

  public void setUnit(String unit) { this.unit = unit; }

  public java.math.BigDecimal getSafetyStock() { return safetyStock; }

  public void setSafetyStock(java.math.BigDecimal safetyStock) { this.safetyStock = safetyStock; }

  public java.math.BigDecimal getInQty() { return inQty; }

  public void setInQty(java.math.BigDecimal inQty) { this.inQty = inQty; }

  public java.math.BigDecimal getInRetQty() { return inRetQty; }

  public void setInRetQty(java.math.BigDecimal inRetQty) { this.inRetQty = inRetQty; }

  public java.math.BigDecimal getOutQty() { return outQty; }

  public void setOutQty(java.math.BigDecimal outQty) { this.outQty = outQty; }

  public java.math.BigDecimal getOutRetQty() { return outRetQty; }

  public void setOutRetQty(java.math.BigDecimal outRetQty) { this.outRetQty = outRetQty; }

  public java.math.BigDecimal getStock() { return stock; }

  public void setStock(java.math.BigDecimal stock) { this.stock = stock; }
}
