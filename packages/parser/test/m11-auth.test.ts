import { describe, expect, it } from 'vitest';
import { parse, parseProject } from '../src/index';

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
@auth(user: 'SystemUser', username: 'username', password: 'password', loginPage: 'Login', registerPage: 'Register')
@export
function login(input: LoginInput): LoginResult {
  const users = SystemUser.where(username = input.username);
  if (users.count === 0) { throw '用户名或密码错误'; }
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
@public
@title('登录')
page Login {
  <form submit={useMutation('login')}>
    <input field="username" label="用户名" />
    <input field="password" label="密码" type="password" />
  </form>
}
`;

describe('M11 鉴权声明（parser）', () => {
  it('@auth KV 解析 → AppNode.auth（user 字段 + 显式页面名）', () => {
    const app = parse(AUTH_SAMPLE);
    expect(app.auth).toBeDefined();
    expect(app.auth!.user).toBe('SystemUser');
    expect(app.auth!.usernameProp).toBe('username');
    expect(app.auth!.passwordProp).toBe('password');
    expect(app.auth!.loginPage).toBe('Login');
    expect(app.auth!.registerPage).toBe('Register');
    // linkApp：用户实体短名 → nodePath
    expect(app.auth!.userPath).toBe('app.datasources.defaultDS.entities.SystemUser');
  });

  it('@public 页面注解进 view.annotations；input type 属性透传', () => {
    const app = parse(AUTH_SAMPLE);
    const login = app.views.find((v) => v.name === 'Login')!;
    expect(login.annotations?.some((a) => a.name === 'public')).toBe(true);
    expect(login.annotations?.some((a) => a.name === 'title')).toBe(true);
    const pw = login.elements[0].children.find((c) => c.type === 'input' && String(c.props.field ?? '') === 'password');
    expect(String(pw?.props['type'] ?? '')).toBe('password');
  });

  it('@auth 缺少必要项 → 语法报错（人话口径）', () => {
    expect(() => parse("@auth(user: 'SystemUser')\n@datasource('defaultDS')\nentity A { id: Integer @pk; }")).toThrow(/user\/username\/password\/loginPage\/registerPage/);
  });

  it('@auth 指向未声明实体 → link 期报错（与类型引用同口径）', () => {
    expect(() =>
      parse("@datasource('defaultDS')\nentity A { id: Integer @pk; }\n@auth(user: 'Ghost', username: 'u', password: 'p', loginPage: 'L', registerPage: 'R')"),
    ).toThrow(/Ghost/);
  });

  it('多文件合并保留唯一 @auth（分片不丢声明）', () => {
    const model = `@datasource('defaultDS')\nentity SystemUser { id: Integer @pk; username: String @unique; password: String; nickname: String; }`;
    const authFile = "@auth(user: 'SystemUser', username: 'username', password: 'password', loginPage: 'Login', registerPage: 'Register')\n@public\npage Login {\n  <form></form>\n}\n@public\npage Register {\n  <form></form>\n}";
    const app = parseProject([
      { path: '00-model.tdsl', content: model },
      { path: '70-auth.tdsl', content: authFile },
    ]);
    expect(app.auth?.userPath).toContain('SystemUser');
    expect(app.views.filter((v) => v.annotations?.some((a) => a.name === 'public'))).toHaveLength(2);
  });

  it('无 @auth 应用 → AppNode.auth 为 undefined（零侵入）', () => {
    const app = parse("@datasource('defaultDS')\nentity A { id: Integer @pk; }");
    expect(app.auth).toBeUndefined();
  });
});
