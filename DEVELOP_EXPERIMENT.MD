# Overleaf CE（sharelatex）OIDC 分支：开发与踩坑记录

> 面向**继续维护这套 OIDC 集成的人**。部署与配置项说明看 [`README.md`](./README.md) / [`README.zh-CN.md`](./README.zh-CN.md)；本文讲清实现方式、设计约束、安全边界和实际踩过的坑。

- 做法：**不重建 Overleaf**，用 `overlay/` 覆盖镜像内的同名源码文件（Overleaf 直接运行 `app/src/**/*.mjs` 与 `app/views/**/*.pug`，无需编译）
- 上游基线：Overleaf CE `6.3.0`（`Dockerfile` 里的基础镜像）；镜像 `lvcs/sharelatex`
- 参考来源：overlay 思路来自 `smhaller/ldap-overleaf-sl`；OIDC 实现是从 `stugen-admins/forks/overleaf-oidc` 移植并重写（见下文的依赖约束）

---

## 1. 改动清单

| 提交 | 内容 |
| --- | --- |
| `9df94e4` | 引入 OIDC 登录与回调地址解析（`OidcCallbackUrl`） |
| `224c869` `90210b8` | 登录支持与错误处理完善、配置要求文档化 |
| `d0febbe` | **只让被担保的邮箱识别账号**（`OidcEmailTrust`） |
| `0cac0a6` | 首次绑定需**确认账号密码**；**自行验证 id_token**（`OidcIdToken`、`OidcLinkRequest`） |
| `2bd219e` | discovery 拿错地址立即报错；比较 `iss` 时忽略尾斜杠 |
| `675fbff` | CI：构建镜像一次，发布拆成独立步骤 |
| `8c5d0ba` | 构建期字体校验 + 文档更新 |
| `1f39b68` `da84d4c` | 镜像名统一为 `lvcs/sharelatex` |
| `3856bd7` | 导航栏布局（与 OIDC 无关） |

---

## 2. 实现结构与职责

| 文件（`overlay/services/web/app/src/...`） | 职责 |
| --- | --- |
| `Features/Authentication/OidcStrategy.mjs` | passport 策略：授权码交换、userinfo 获取、账号关联决策 |
| `Features/Authentication/OidcIdToken.mjs` | **id_token 校验**：JWKS 签名、`iss`/`aud`/`exp`/`nonce` |
| `Features/Authentication/OidcEmailTrust.mjs` | 判定一个邮箱是否**可信到足以识别账号** |
| `Features/Authentication/OidcLinkRequest.mjs` | 首次绑定流程（需要账号密码确认） |
| `Features/Authentication/OidcCallbackUrl.mjs` | 回调地址解析：显式配置 → 多域名列表 → 按请求推导 |
| `Features/Authentication/OidcDiscovery.mjs` | `.well-known` 发现，含失败快速报错 |
| `Features/Authentication/AuthenticationController.mjs` | 路由与流程编排（原文件被整体替换） |
| `Features/User/UserPrimaryEmailCheckHandler.mjs`、`models/User.mjs` | 邮箱/账号状态相关的必要适配 |
| `infrastructure/{Features,Server,ExpressLocals}.mjs`、`router.mjs` | 特性开关与路由注册 |
| `views/user/{login.pug,login-oidc-link.pug}`、`views/layout/navbar-marketing.pug` | 登录入口与绑定确认页 |

配置面（详见 README）：`OVERLEAF_OIDC_ISSUER`（未设置 = 关闭 OIDC）、`OVERLEAF_OIDC_WELL_KNOWN_URL` 或手工端点、`OVERLEAF_OIDC_CLIENT_ID/CLIENT_SECRET`、`OVERLEAF_OIDC_CALLBACK_URL` 或 `OVERLEAF_OIDC_CALLBACK_URLS`。

---

## 3. 设计约束（决定了实现长什么样）

### 3.1 不能新增 npm 依赖
镜像用 **Yarn PnP** 安装依赖，overlay 只是替换文件、不会重新安装依赖，所以**任何新包都加载不到**。原补丁依赖 `@govtechsg/passport-openidconnect`，这里改为基于镜像内已有的 `passport-oauth2` 自写策略。**后续任何改动都必须先确认用到的模块在镜像里已存在**（`node_modules` 里的包，或 Node 内置模块）。

### 3.2 覆盖式 patch 的维护成本在升级时兑现
`overlay/` 下的文件是**完整替换**，不是 diff。上游每次改到这些文件，overlay 就会把它覆盖回去。**升级上游时必须逐个对账**：把 overlay 文件与新版上游同名文件 diff 一遍，确认没有把上游的安全修复/功能改回去。这条是整个方案最大的长期成本，务必写进升级清单。

### 3.3 只在必要处替换
除 `AuthenticationController.mjs`（流程编排，必须整体替换）外，其余都是新增文件（`Oidc*.mjs`）；对既有文件的侵入尽量小（`User.mjs`、`UserPrimaryEmailCheckHandler.mjs`、`infrastructure/*` 都是小改动）。**新增功能优先做成新文件 + 最小挂载点**，升级对账面会小很多。

---

## 4. 安全经验（这次踩过/防住的）

1. **只有 IdP 明确担保的邮箱才能识别账号**（`d0febbe`）。否则任何能在某个 IdP 上注册同邮箱的人都能顶替既有账号——这是 OIDC 集成里最容易漏、后果最重的一条。
2. **首次绑定要用既有账号的密码二次确认**（`0cac0a6`）。仅凭邮箱相同就自动关联，会让 IdP 侧的账号劫持直接变成 Overleaf 账号接管。
3. **id_token 必须自行校验**（`OidcIdToken.mjs`：签名、`iss`、`aud`、`exp`、`nonce`）。只读 userinfo 的实现在异构 IdP 下会被伪造或重放。
4. **issuer 比较要忽略尾斜杠**（`2bd219e`）——不同 IdP 对 `iss` 的写法不一致，严格字符串比较会随机失败。
5. **discovery 失败要立刻报错**：拿到 HTML（例如被网关/代理拦成登录页）时如果不在启动/登录入口就报出来，错误会推迟到真正登录时才出现，用户只看到"登录失败"，极难定位。
6. **回调地址来自配置或请求**：显式配置优先，其次多域名列表，最后按请求主机推导；多域名/反代部署用 `OVERLEAF_OIDC_CALLBACK_URLS`。**IdP 侧必须登记所有实际用到的回调地址**——这是代码之外、只能由部署方完成的一步。

---

## 5. 验证手册

用例是**纯函数级**的 `.mjs`，不加载整个应用（模块只依赖 `node:url` 等内置模块）：

```sh
# 本地（65 个用例：callback-url 13、id-token 13、well-known 24、link-request 8、email-trust 7）
node --test tests/oidc-callback-url.test.mjs tests/oidc-well-known.test.mjs \
            tests/oidc-id-token.test.mjs tests/oidc-link-request.test.mjs \
            tests/oidc-email-trust.test.mjs

# 镜像内
node --test /tests/oidc-*.test.mjs

# 对真实 IdP 的往返（需要实例与凭据）
tests/verify-oidc.sh
```

- 改动 `Oidc*.mjs` 时**先补/改用例**再改实现：这些模块能在没有 Overleaf 的环境里独立跑，是这套方案里最划算的验证手段。
- 登录流程本身（跳转、绑定确认页、账号关联）**只能在实例上端到端验证**；本地跑绿不等于流程可用，提交信息里要写清哪部分已验证、哪部分没有。

---

## 6. CI 与镜像

- `build-test.yml`：跑测试 + 构建；`docker-build.yml`：产出镜像；`docker-publish.yml`：**发布单独一步**（与 AFFiNE 分支同一套思路：构建一次、发布只做搬运与打标签）。
- 构建期做**字体校验**（`8c5d0ba`）：缺字体这类问题在构建期暴露，比运行时排版错乱好定位得多。
- 必需 secret：`OVERLEAF_INVITE_TOKEN_SECRET`（缺失会导致实例异常，README 已说明）；镜像名由 `OVERLEAF_IMAGE_NAME=lvcs/sharelatex` 指定。

---

## 7. 待办与注意事项

- **上游升级对账**（§3.2）目前是人工步骤，建议每次升级后把 overlay 与上游同名文件的 diff 作为升级记录的一部分提交。
- 本地能验证到"模块级"为止；登录流程、绑定页、IdP 侧回调白名单都依赖实例，需要人工确认。
- 若将来要支持更多 IdP 特性（如 `preferred_username`、组映射），注意仍受 §3.1 的依赖约束。
