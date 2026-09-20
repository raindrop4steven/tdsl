import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { check } from '../src/index';

const SAMPLE = (decl: string, extra = '') => `
@datasource('defaultDS')
entity SystemUser {
  id: Integer @pk;
  username: String @unique;
  password: String;
  nickname: String;
}
struct LoginInput { username: String; password: String; }
struct LoginResult { token: String; nickname: String; userId: Integer; }
${decl}
@export
function login(input: LoginInput): LoginResult {
  const users = SystemUser.where(username = input.username);
  for (const u of users) {
    const r = new LoginResult();
    r.nickname = u.nickname;
    r.userId = u.id;
    return r;
  }
  throw '用户名或密码错误';
}
interface AuthApi {
  POST '/api/auth/login' -> login
}
${extra || `@public
@title('注册')
page Register {
  <form></form>
}`}
@public
@title('登录')
page Login {
  <form submit={useMutation('login')}>
    <input field="username" label="用户名" />
    <input field="password" label="密码" type="password" />
  </form>
}
`;

describe('M11 @auth 校验（typecheck）', () => {
  it('合法 @auth → 0 问题', () => {
    const app = parse(SAMPLE("@auth(user: 'SystemUser', username: 'username', password: 'password', loginPage: 'Login', registerPage: 'Register')"));
    const r = check(app);
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toHaveLength(0);
  });

  it('AUTH-USER：用户实体不存在 → link 期即报错（先于 typecheck，与类型引用同口径）', () => {
    expect(() => parse(SAMPLE("@auth(user: 'Ghost', username: 'username', password: 'password', loginPage: 'Login', registerPage: 'Register')"))).toThrow(/Ghost/);
  });

  it('AUTH-FIELD：password 字段缺失', () => {
    const app = parse(SAMPLE("@auth(user: 'SystemUser', username: 'username', password: 'pwd', loginPage: 'Login', registerPage: 'Register')"));
    const r = check(app);
    const d = r.diagnostics.find((x) => x.code === 'AUTH-FIELD');
    expect(d?.severity).toBe('error');
    expect(d?.message).toContain('pwd');
  });

  it('AUTH-UNIQUE：username 无 @unique → warning（不阻断）', () => {
    const app = parse(SAMPLE(
      "@auth(user: 'SystemUser', username: 'nickname', password: 'password', loginPage: 'Login', registerPage: 'Register')",
    ));
    const r = check(app);
    const d = r.diagnostics.find((x) => x.code === 'AUTH-UNIQUE');
    expect(d?.severity).toBe('warning');
    expect(r.ok).toBe(true);
  });

  it('AUTH-PAGE：注册页不存在或未标 @public', () => {
    // extra 传入注释占位 → SAMPLE 不注入默认 Register 页
    const app = parse(SAMPLE("@auth(user: 'SystemUser', username: 'username', password: 'password', loginPage: 'Login', registerPage: 'Register')", '// no register page'));
    const r = check(app);
    const d = r.diagnostics.find((x) => x.code === 'AUTH-PAGE');
    expect(d?.severity).toBe('error');
    expect(d?.message).toContain('Register');
  });

  it('无 @auth → 零新诊断（护栏）', () => {
    const app = parse(`
@datasource('defaultDS')
entity User {
  id: Integer @pk;
  username: String;
  password: String;
}
@export
function login(username: String, password: String): String {
  return username;
}
`);
    const r = check(app);
    expect(r.diagnostics.filter((d) => d.code.startsWith('AUTH'))).toHaveLength(0);
  });
});
