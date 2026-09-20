import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { generateJava } from '../src/index';

const AUTH_SAMPLE = `
@datasource('defaultDS')
entity SystemUser {
  id: Integer @pk;
  username: String @unique;
  password: String;
  nickname: String;
}
struct LoginInput { username: String; password: String; }
struct LoginResult { token: String; nickname: String; userId: Integer; }
struct RegisterInput { username: String; password: String; nickname: String; }
@auth(user: 'SystemUser', username: 'username', password: 'password', loginPage: 'Login', registerPage: 'Register')
@export
function login(input: LoginInput): LoginResult {
  const users = SystemUser.where(username = input.username);
  if (users.count === 0) { throw '用户名或密码错误'; }
  for (const u of users) {
    if (Auth.matches(input.password, u.password, u.username) === false) { throw '用户名或密码错误'; }
    const r = new LoginResult();
    r.nickname = u.nickname;
    r.userId = u.id;
    return r;
  }
  throw '用户名或密码错误';
}
@export
function register(input: RegisterInput): SystemUser {
  const exists = SystemUser.where(username = input.username);
  if (exists.count > 0) { throw '用户名已存在'; }
  const u = new SystemUser();
  u.username = input.username;
  u.password = Auth.hash(input.password, input.username);
  u.nickname = input.nickname;
  u.save();
  return u;
}
interface AuthApi {
  POST '/api/auth/login' -> login
  POST '/api/auth/register' -> register
}
`;

const NO_AUTH_SAMPLE = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
}
@export
function findTodos(): List<Todo> {
  return Todo.all;
}
interface TodoApi {
  GET '/api/todos' -> findTodos
}
`;

describe('M11 鉴权层（codegen-java）', () => {
  it('@auth 应用 → 生成五件套 + schema.sql 含 auth_token', () => {
    const files = generateJava(parse(AUTH_SAMPLE));
    const names = files.map((f) => f.path);
    expect(names).toContain('src/main/java/com/todo/entity/AuthToken.java');
    expect(names).toContain('src/main/java/com/todo/repository/AuthTokenRepository.java');
    expect(names).toContain('src/main/java/com/todo/support/PasswordUtil.java');
    expect(names).toContain('src/main/java/com/todo/support/AuthInterceptor.java');
    expect(names).toContain('src/main/java/com/todo/support/WebMvcConfig.java');
    const schema = files.find((f) => f.path.endsWith('schema.sql'))!.content;
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS auth_token');
  });

  it('拦截器：放行 /healthz 与 /api/auth/**，无效 token 返回 401', () => {
    const files = generateJava(parse(AUTH_SAMPLE));
    const interceptor = files.find((f) => f.path.endsWith('AuthInterceptor.java'))!.content;
    expect(interceptor).toContain('Bearer ');
    expect(interceptor).toContain('setStatus(401)');
    const cfg = files.find((f) => f.path.endsWith('WebMvcConfig.java'))!.content;
    expect(cfg).toContain('"/healthz"');
    expect(cfg).toContain('"/api/auth/**"');
  });

  it('密码哈希 platform 域直发（PasswordUtil 全限定，无伪 import）', () => {
    const files = generateJava(parse(AUTH_SAMPLE));
    const register = files.find((f) => f.path.endsWith('RegisterService.java'))!.content;
    expect(register).toContain('PasswordUtil.hash(');
    expect(register).not.toContain('import tdsl.auth.');
    const login = files.find((f) => f.path.endsWith('LoginService.java'))!.content;
    expect(login).toContain('PasswordUtil.matches(');
  });

  it('login Service：内层私有方法 + 公开包装注入 token 签发（TDSL 无感）', () => {
    const files = generateJava(parse(AUTH_SAMPLE));
    const login = files.find((f) => f.path.endsWith('LoginService.java'))!.content;
    expect(login).toContain('public LoginResult login(');
    expect(login).toContain('private LoginResult loginInner(');
    expect(login).toContain('UUID.randomUUID()');
    expect(login).toContain('__result.setToken(__token)');
    // 注册 service 不注入签发
    expect(files.find((f) => f.path.endsWith('RegisterService.java'))!.content).not.toContain('UUID.randomUUID()');
  });

  it('无 @auth → 零鉴权产物（护栏）', () => {
    const files = generateJava(parse(NO_AUTH_SAMPLE));
    const names = files.map((f) => f.path);
    expect(names.every((n) => !n.includes('AuthToken'))).toBe(true);
    expect(names.every((n) => !n.includes('AuthInterceptor'))).toBe(true);
    const schema = files.find((f) => f.path.endsWith('schema.sql'))!.content;
    expect(schema).not.toContain('auth_token');
  });
});
