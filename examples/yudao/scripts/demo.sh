#!/usr/bin/env bash
# TDSL 演示一键脚本：TDSL 分片 → 生成 Java + React → 起前后端 → 灌演示数据
# 用法：npm run demo （在 examples/yudao 下）；或 bash scripts/demo.sh
# 依赖：dsl 命令（来自 @tdsl/cli；仓库内由 workspace 链接，新环境 npm i -D @tdsl/cli）
set -e
cd "$(dirname "$0")/.."

BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
# 编译器 CLI：优先 env 覆盖，其次 PATH 上的 dsl（npm run 会把 node_modules/.bin 加入 PATH）
DSL="${TDSL_CLI:-tdsl}"
if ! command -v "$DSL" >/dev/null 2>&1; then
  echo "未找到编译器命令 'tdsl'。请安装：npm i -D @tdsl/cli"
  echo "（仓库内开发：在仓库根 npm install，workspaces 会自动链接 @tdsl/cli）"
  exit 1
fi

free_port() {
  local port="$1"
  if command -v netstat >/dev/null 2>&1; then
    local pids
    pids="$(netstat -ano 2>/dev/null | grep -E "[:.]${port}[[:space:]].*LISTENING" | awk '{print $NF}' | sort -u)"
    for pid in $pids; do [ -n "$pid" ] && taskkill //F //PID "$pid" >/dev/null 2>&1 || true; done
  fi
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti ":${port}" 2>/dev/null || true)"
    for pid in $pids; do kill -9 "$pid" >/dev/null 2>&1 || true; done
  fi
}

echo "──────────────────────────────────────────────"
echo " 1/5  编译 + 生成双端代码（TDSL → Java/React）"
echo "──────────────────────────────────────────────"
npm run check        # 编译裁判：0 问题才继续
npm run gen

echo
echo "──────────────────────────────────────────────"
echo " 2/5  启动后端（Spring Boot + H2 内存库，:${BACKEND_PORT}）"
echo "──────────────────────────────────────────────"
free_port "$BACKEND_PORT"
(cd generated/java && mvn -q spring-boot:run > /tmp/yudao-backend.log 2>&1 &)
for i in $(seq 1 90); do
  sleep 2
  code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://localhost:${BACKEND_PORT}/healthz" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && { echo "  后端就绪（${i}×2s）"; break; }
done
[ "$code" = "200" ] || { echo "  后端启动失败，见 /tmp/yudao-backend.log"; exit 1; }

echo
echo "──────────────────────────────────────────────"
echo " 3/5  灌演示数据（产品/库存/采购/销售/CRM 全链路）"
echo "──────────────────────────────────────────────"
npm run seed -- "http://localhost:${BACKEND_PORT}"

echo
echo "──────────────────────────────────────────────"
echo " 4/5  启动前端（Vite dev，:${FRONTEND_PORT}）"
echo "──────────────────────────────────────────────"
free_port "$FRONTEND_PORT"
(cd generated/react && npm run dev > /tmp/yudao-frontend.log 2>&1 &)
for i in $(seq 1 30); do
  sleep 1
  code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://localhost:${FRONTEND_PORT}/" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && { echo "  前端就绪（${i}s）"; break; }
done

echo
echo "──────────────────────────────────────────────"
echo " 5/5  演示环境就绪 🎉"
echo "──────────────────────────────────────────────"
echo "  前端：http://localhost:${FRONTEND_PORT}      （门户/看板 → 列表 → 详情抽屉 → 审批联动）"
echo "  后端：http://localhost:${BACKEND_PORT}       （REST API；H2 内存库，重启需重新灌数）"
echo "  日志：/tmp/yudao-backend.log  /tmp/yudao-frontend.log"
echo "  停止：npm run stop"
echo
echo "  演示动线建议："
echo "   1) 经营总览（指标卡/轮播/列表）→ 采购入库列表"
echo "   2) 未审批入库行只剩「审批」→ 点审批 → 库存/流水/订单回写（打开订单详情看 inCount）"
echo "   3) 销售出库审批：库存不足会被拦截并回滚（业务错误弹窗）"
echo "   4) 客户列表：公海客户「领取」/ 已锁定客户「编辑」置灰 + 操作成功提示"
