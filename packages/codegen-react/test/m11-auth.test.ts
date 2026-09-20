import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { generateReact } from '../src/index';

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
  POST '/api/auth/register' -> register
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
@export
function queryUsers(): List<SystemUser> {
  return SystemUser.all;
}
@public
@title('登录')
page Login {
  <form submit={useMutation('login')}>
    <input field="username" label="用户名" />
    <input field="password" label="密码" type="password" />
  </form>
}
@public
@title('注册')
page Register {
  <form submit={useMutation('register')}>
    <input field="username" label="用户名" />
    <input field="password" label="密码" type="password" />
  </form>
}
page Users {
  <table dataSource={useQuery('queryUsers')}>
    <column field="username" title="用户名" />
  </table>
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
page Todos {
  <table dataSource={useQuery('findTodos')}>
    <column field="title" title="标题" />
  </table>
}
`;

describe('M11 会话与守卫（codegen-react）', () => {
  it('auth.ts 生成：token 存取 + authFetch 注入头 + 401 回流', () => {
    const files = generateReact(parse(AUTH_SAMPLE));
    expect(files.find((f) => f.path === 'src/auth.ts')).toBeDefined();
    const auth = files.find((f) => f.path === 'src/auth.ts')!.content;
    expect(auth).toContain('Authorization');
    expect(auth).toContain("window.location.href = '/login'");
  });

  it('api.ts 全量走 authFetch（无裸 fetch）', () => {
    const files = generateReact(parse(AUTH_SAMPLE));
    const api = files.find((f) => f.path === 'src/api.ts')!.content;
    expect(api).toContain("import { authFetch } from './auth';");
    expect(api).toContain('authFetch(');
    expect(api).not.toMatch(/[^h]fetch\(/);
  });

  it('App.tsx：RequireAuth 守卫 + 公开页布局外 + 顶栏用户区 + 退出；公开页不进菜单', () => {
    const files = generateReact(parse(AUTH_SAMPLE));
    const appTsx = files.find((f) => f.path === 'src/App.tsx')!.content;
    expect(appTsx).toContain('function RequireAuth');
    expect(appTsx).toContain('function AlreadyAuth');
    expect(appTsx).toContain('<RequireAuth><Users /></RequireAuth>');
    expect(appTsx).toContain('退出登录');
    expect(appTsx).toContain('clearAuth(); nav(\'/login\')');
    // 登录/注册不在 MODULES/PAGE_MODULE（不进菜单）
    const modules = appTsx.slice(appTsx.indexOf('const MODULES'), appTsx.indexOf('const FIRST_ROUTES'));
    expect(modules).not.toContain('/login');
    expect(modules).not.toContain('/register');
  });

  it('登录页：全屏企业风 + Input.Password + 成功 setAuth 回首页；注册页成功去登录', () => {
    const files = generateReact(parse(AUTH_SAMPLE));
    const login = files.find((f) => f.path === 'src/pages/Login.tsx')!.content;
    expect(login).toContain('Input.Password');
    expect(login).toContain('setAuth(String(d?.token ?? \'\'), String(d?.nickname ?? \'\'))');
    expect(login).toContain("nav('/')");
    expect(login).toContain('欢迎登录');
    const register = files.find((f) => f.path === 'src/pages/Register.tsx')!.content;
    expect(register).toContain("nav('/login')");
  });

  it('无 @auth → 无 auth.ts、api 保留原 fetch、App 无守卫（护栏）', () => {
    const files = generateReact(parse(NO_AUTH_SAMPLE));
    expect(files.find((f) => f.path === 'src/auth.ts')).toBeUndefined();
    const api = files.find((f) => f.path === 'src/api.ts')!.content;
    expect(api).not.toContain('authFetch');
    const appTsx = files.find((f) => f.path === 'src/App.tsx')!.content;
    expect(appTsx).not.toContain('RequireAuth');
    expect(appTsx).not.toContain('PUBLIC_PATHS');
  });
});
