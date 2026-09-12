package com.evalapp.support;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 统一错误面：TdslError → 400 {code, message}；其余异常 → 500 {message} */
@RestControllerAdvice
public class GlobalAdvice {
  @ExceptionHandler(TdslError.class)
  public org.springframework.http.ResponseEntity<java.util.Map<String, Object>> tdslError(TdslError e) {
    java.util.Map<String, Object> body = new java.util.HashMap<>();
    body.put("code", e.getCode());
    body.put("message", e.getMessage());
    return org.springframework.http.ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
  }

  @ExceptionHandler(Exception.class)
  public org.springframework.http.ResponseEntity<java.util.Map<String, Object>> unexpected(Exception e) {
    java.util.Map<String, Object> body = new java.util.HashMap<>();
    body.put("code", "INTERNAL");
    body.put("message", e.getMessage());
    return org.springframework.http.ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
  }
}
