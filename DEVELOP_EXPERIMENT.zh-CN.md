# Overleaf CE（sharelatex）OIDC 分支 — 开发经验（skill 式）

> **什么时候读这份文件。** 改动 `overlay/` 下任何东西之前、OIDC 登录流程异常时、以及升级上游 Overleaf 版本时。部署与配置**用法**看 [`README.zh-CN.md`](./README.zh-CN.md)；这份文件是**开发经验**——overlay 怎么工作、代价在哪、这条集成依赖哪些安全规则、以及怎么验证一次改动。
>
> 全文写成规则：**做 X → 因为 Y → 用 Z 验证**。按需查阅。

- 做法：**不重建 Overleaf**。`overlay/` 里是**完整替换文件**，被复制进 `sharelatex/sharelatex` 镜像；Overleaf 直接运行这些源码（`app/src/**/*.mjs`、`app/views/**/*.pug`），没有编译步骤。
- 上游基线：Overleaf CE `6.3.0`；发布镜像 `lvcs/sharelatex`
- 参考来源：overlay 思路来自 `smhaller/ldap-overleaf-sl`；OIDC 实现由 `stugen-admins/forks/overleaf-oidc` 移植并重写（见 S2）

## 快速索引

| 规则 | 什么时候用 |
| --- | --- |
| S1 每次升级上游都要对账 overlay | 换基础镜像时 |
| S2 不引入 npm 依赖 | 你想 import 一个新包 |
| S3 只有被担保的邮箱才能识别账号 | 改账号匹配逻辑 |
| S4 首次绑定要账号密码确认 | 改绑定流程 |
| S5 自己验证 id_token | 改 token / userinfo 处理 |
| S6 比较 issuer 时忽略尾斜杠 | 合法 IdP 登录却失败 |
| S7 discovery 出错要立刻报 | 配置指向了错误地址 |
| S8 优先新增文件、少改上游文件 | 加功能时 |
| S9 模块级测试，且先写测试 | 改任何 `Oidc*.mjs` |
| S10 回调地址：显式配置 > 列表 > 请求 | 多域名 / 反代部署 |
| S11 明说只有实例能验证的部分 | 准备写"完成"之前 |

---

## S1. 每次升级上游都要对账 overlay

**做。** 换基础镜像前，把 `overlay/` 下每个文件与新版上游同路径文件 **diff** 一遍，并把结果当作升级内容的一部分：overlay 文件会**静默覆盖掉**上游在该文件里的改动。

**因为。** overlay 是**整文件替换**，不是补丁序列。这就是这套方案的长期成本——而唯一必须整文件替换的 `AuthenticationController.mjs`（改了 244 行）恰好也是上游最容易变动的文件。

**验证。** 在上游路径上 `git log --oneline`，然后逐文件 `diff`，把对账结果写进升级提交。

---

## S2. 不引入 npm 依赖

**做。** 只用镜像里已有的东西：已打包的依赖或 Node 内置模块；小功能自己重写，不要 import 新包。

**因为。** 镜像用 **Yarn PnP** 安装依赖，overlay 只替换文件、从不重装依赖，新包根本无法解析。原补丁依赖 `@govtechsg/passport-openidconnect`，本分支改为基于镜像已有的 `passport-oauth2` 自写策略。

**验证。** `grep -rn "from '" overlay/**/*.mjs`，确认每个 import 要么是 Node 内置、要么是镜像里可见的包。

---

## S3. 只有被担保的邮箱地址才能识别账号

**做。** 只有当提供方**担保**该地址（`email_verified` 或等价的信任信号）时，才用它识别账号。把这个判断收敛在一处（`OidcEmailTrust.mjs`）并写测试。

**因为。** 否则任何能在**某个**提供方注册同一邮箱的人都能顶替既有的 Overleaf 账号。这是 OIDC 集成里代价最高的错误，而且常规测试完全看不出来。

**验证。** `node --test tests/oidc-email-trust.test.mjs`。

---

## S4. 首次绑定必须用账号密码确认

**做。** OIDC 身份与既有账号邮箱匹配时，先要求输入该账号密码，再执行绑定；展示确认页（`login-oidc-link.pug`）。

**因为。** 自动绑定会把"提供方侧被攻陷"直接变成"Overleaf 账号被接管"。确认这一步保留了第二重证明。

**验证。** 在真实实例上走一遍绑定流程：用匹配邮箱登录必须停在确认页，而不是直接进入账号。

---

## S5. 自己验证 id_token

**做。** 在 `OidcIdToken.mjs` 中校验签名（JWKS）、`iss`、`aud`、`exp` 与 `nonce`；不要把 userinfo 当成足够依据。

**因为。** 只读 userinfo 的实现在异构提供方下可被伪造和重放。这个校验点同时也是"issuer 配错"能被清楚报出来的地方，而不是表现为随机的登录失败。

**验证。** `node --test tests/oidc-id-token.test.mjs`。

---

## S6. 比较 issuer 时忽略尾斜杠

**做。** 与配置里的 issuer 比较前先归一化 `iss`。

**因为。** 不同提供方对尾斜杠的写法不一致；严格字符串比较会在完全合法的 IdP 上间歇性失败。

**验证。** `node --test tests/oidc-well-known.test.mjs`。

---

## S7. discovery 出错要立刻报

**做。** 校验 discovery 文档确实是预期内容，并在配置/启动阶段就抛出错误。

**因为。** 当 well-known 地址返回 HTML（被代理/网关拦成登录页）时，失败会推迟到很久之后、只表现为"登录失败"，用户看不到到底是哪个 URL 错了。自 `2bd219e` 起会立即报出错误地址。

**验证。** 把 issuer 指向一个 HTML 页面，确认错误信息里点名了它。

---

## S8. 优先新增文件，少改上游文件

**做。** 功能实现为新的 `Oidc*.mjs` 文件 + 尽可能小的挂载点；对上游文件的修改保持最小。

**因为。** 每多改一个上游文件，S1 的对账面就更大。目前只有 `AuthenticationController.mjs` 是整文件替换；对既有文件的改动（`User.mjs`、`UserPrimaryEmailCheckHandler.mjs`、`infrastructure/*`）都是刻意做小的。

**验证。** 与上一次 overlay 状态 `git diff --stat`。

---

## S9. 模块级测试，且先写测试

**做。** 改模块前先在 `tests/oidc-*.test.mjs` 里补/改用例。这些模块只依赖 Node 内置模块，不需要 Overleaf 环境：

```sh
node --test tests/oidc-callback-url.test.mjs tests/oidc-well-known.test.mjs \
            tests/oidc-id-token.test.mjs tests/oidc-link-request.test.mjs \
            tests/oidc-email-trust.test.mjs          # 共 65 例：13+13+24+8+7
node --test /tests/oidc-*.test.mjs                   # 镜像内
```

**因为。** 这是本仓库里最划算、也是唯一能在本地跑的验证手段。

**验证。** 65 例全绿。

---

## S10. 回调地址：显式配置 → 列表 → 请求

**做。** 按此顺序解析 redirect URI：`OVERLEAF_OIDC_CALLBACK_URL` → `OVERLEAF_OIDC_CALLBACK_URLS`（逗号或空白分隔，多主机部署用）→ 按用户访问的主机推导。**所有**结果都要在提供方登记。

**因为。** 可通过多个名字（内网、Tailscale、反代域名）访问的部署，每个名字都需要匹配的回调地址；而提供方侧的白名单是任何代码改动都替代不了的一步。

**验证。** `node --test tests/oidc-callback-url.test.mjs`，再从每个主机各走一次真实往返。

---

## S11. 明说只有实例能验证的部分

**做。** 在提交信息里区分"本地跑过"（65 个模块用例）与"需要实例"（登录流程、绑定页、提供方白名单）。

**因为。** 本地全绿说明不了流程可用；`tests/verify-oidc.sh` 加上一次真实登录才是端到端证据。

---

## 提交前检查清单

1. `node --test tests/oidc-*.test.mjs`（65 例）——新行为要补用例。
2. 每个 import 都是内置模块或镜像里已有（S2）。
3. 上游基线变动时已完成 overlay 对账（S1）。
4. 提交信息：现象、影响面、`Verified:` / `Not verified:` 分列。
5. CI：`build-test.yml`（测试 + 构建）→ `docker-build.yml` → `docker-publish.yml`（发布是独立的手工步骤；构建期字体校验保留）。

## 待办

- 上游对账（S1）目前是人工步骤；建议每次升级把 overlay 与上游的 diff 一并提交。
- 多提供方特性（组映射、`preferred_username`）在设计前先受 S2 约束。
