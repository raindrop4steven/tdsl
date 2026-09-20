/**
 * 启动 yudao 后端：默认连本机 MySQL（库 erp），跨平台注入数据库环境变量。
 * 用法：npm run backend [-- <额外 mvn 参数>]
 * 覆盖：TDSL_DB_URL / TDSL_DB_USER / TDSL_DB_PASSWORD / TDSL_BACKEND_PORT（不设则用下面默认）。
 * 说明：生成工程默认 H2 内存库；本包装把三件套注入 env，Spring 由 TDSL_DB_URL 覆盖 dataSource。
 */
import { spawn } from 'node:child_process';

const DEFAULT_DB_URL =
  'jdbc:mysql://localhost:3306/erp?createDatabaseIfNotExist=true&useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai';

const env = {
  ...process.env,
  TDSL_BACKEND_PORT: process.env.TDSL_BACKEND_PORT ?? '8080',
  TDSL_DB_URL: process.env.TDSL_DB_URL ?? DEFAULT_DB_URL,
  TDSL_DB_USER: process.env.TDSL_DB_USER ?? 'root',
  TDSL_DB_PASSWORD: process.env.TDSL_DB_PASSWORD ?? '123456',
};

const args = ['-f', 'generated/java/pom.xml', 'spring-boot:run', ...process.argv.slice(2)];
console.log(`[backend] port=${env.TDSL_BACKEND_PORT} user=${env.TDSL_DB_USER} url=${env.TDSL_DB_URL}`);

const child = spawn('mvn', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
