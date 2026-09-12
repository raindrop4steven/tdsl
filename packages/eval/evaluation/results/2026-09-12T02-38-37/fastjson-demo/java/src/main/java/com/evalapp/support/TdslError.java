package com.evalapp.support;

/** TDSL 业务错误（throw 语句的框架载体；全局 advice 映 4xx {code, message}） */
public class TdslError extends RuntimeException {
  private final String code;

  public TdslError(String message) {
    super(message);
    this.code = "GENERIC";
  }

  public TdslError(String code, String message) {
    super(message);
    this.code = code;
  }

  public String getCode() {
    return code;
  }
}
