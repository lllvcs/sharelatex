# Overleaf CE（sharelatex）OIDC 分支 — 开发记录

> **这份文件是什么。** 记录本分支如何给 Overleaf CE 加上 OIDC 单点登录、以及构建过程中真实发生过什么：实现结构、后来修掉的安全问题、现有的验证手段、以及这套方案自带的坑。写给**准备改它、需要历史而不是规则**的开发者。
>
> 从这些记录里提炼出的**规则**在 [`DEVELOP_SKILL.MD`](./DEVELOP_SKILL.MD)（英文，面向 agent）。配置与部署**用法**见 [`README.zh-CN.md`](./README.zh-CN.md)。

- 做法：**不重建 Overleaf**——`overlay/` 里是完整替换文件，被复制进 `sharelatex/sharelatex` 镜像；Overleaf 直接运行这些源码，没有编译步骤。
- 上游基线：Overleaf CE `6.3.0`；发布镜像 `lvcs/sharelatex`
- 参考来源：overlay 机制来自 `smhaller/ldap-overleaf-sl`；OIDC 实现由 `stugen-admins/forks/overleaf-oidc` 移植。

---

## 1. 改动清单

| 提交 | 内容 |
| --- | --- |
| `9df94e4` | 引入 OIDC 登录与回调地址解析（`OidcCallbackUrl`） |
| `224c869` `90210b8` | 完善登录支持与错误处理；把配置要求写进文档 |
| `d0febbe` | **只有被担保的邮箱才能识别账号**（`OidcEmailTrust`） |
| `0cac0a6` | 首次绑定需确认**账号密码**；**自行验证 id_token**（`OidcIdToken`、`OidcLinkRequest`） |
| `2bd219e` | discovery 地址写错立即报错；比较 `iss` 时忽略尾斜杠 |
| `675fbff` | CI：构建镜像一次，发布拆成独立步骤 |
| `8c5d0ba` | 构建期字体校验 + 文档更新 |
| `1f39b68` `da84d4c` | 镜像名统一为 `lvcs/sharelatex` |
| `3856bd7` | 导航栏布局（与 OIDC 无关） |

---

## 2. 实现结构

Overleaf 把后端以普通 ESM 源码形式放在镜像里（`app/src/**/*.mjs`、`app/views/**/*.pug`），所以**替换镜像内这些文件**即可改变行为、无需重建。overlay 因此包含：

| 文件（`overlay/services/web/app/src/...`） | 职责 |
| --- | --- |
| `Features/Authentication/OidcStrategy.mjs` | passport 策略：授权码交换、userinfo、账号匹配 |
| `Features/Authentication/OidcIdToken.mjs` | id_token 校验：JWKS 签名、`iss`/`aud`/`exp`/`nonce` |
| `Features/Authentication/OidcEmailTrust.mjs` | 判定某邮箱是否可用来识别账号 |
| `Features/Authentication/OidcLinkRequest.mjs` | 首次绑定流程（密码确认） |
| `Features/Authentication/OidcCallbackUrl.mjs` | 回调地址：显式配置 → 列表 → 按请求推导 |
| `Features/Authentication/OidcDiscovery.mjs` | `.well-known` 发现，失败即报 |
| `Features/Authentication/AuthenticationController.mjs` | 路由与流程编排（整文件替换） |
| `Features/User/UserPrimaryEmailCheckHandler.mjs`、`models/User.mjs` | 最小化的账号/邮箱适配 |
| `infrastructure/{Features,Server,ExpressLocals}.mjs`、`router.mjs` | 特性开关与路由注册 |
| `views/user/{login.pug,login-oidc-link.pug}`、`views/layout/navbar-marketing.pug` | 登录入口与绑定确认页 |

**决定实现形态的约束：** 镜像用 **Yarn PnP** 安装依赖，overlay 从不重装依赖——**新包无法解析**。上游补丁依赖 `@govtechsg/passport-openidconnect`，本分支改为基于镜像已有的 `passport-oauth2` 自写策略。任何 import 都必须是 Node 内置模块或镜像里已有的包。

---

## 3. 首个可用版本之后修掉的安全问题

第一版能登录了；让它**可以暴露到线上**的是下面三条。

### 3.1 未验证的邮箱就能识别账号（`d0febbe`）

**风险：** 仅凭邮箱匹配，意味着任何能在**某个**提供方注册同一地址的人都能顶替既有的 Overleaf 账号。
**修复：** 只有被**担保**的地址（`email_verified` 之类的提供方背书）才能识别账号；判断收敛在 `OidcEmailTrust.mjs`，并由 `tests/oidc-email-trust.test.mjs` 覆盖。

### 3.2 绑定时没有证明对账号的控制权（`0cac0a6`）

**风险：** 自动绑定会把"提供方侧被攻陷"直接变成"Overleaf 账号被接管"。
**修复：** OIDC 身份与既有账号匹配时，先要求输入该账号**密码**；确认页由 `login-oidc-link.pug` 渲染。

### 3.3 id_token 被"信任"而非"验证"（`0cac0a6`）

**风险：** 只读 userinfo 的实现在异构提供方下可被伪造与重放。
**修复：** `OidcIdToken.mjs` 校验签名（JWKS）、`iss`、`aud`、`exp`、`nonce`；由 `tests/oidc-id-token.test.mjs` 覆盖。

### 3.4 后续加固（`2bd219e`）

- 比较 `iss` 前归一化尾斜杠——不同提供方写法不一致，严格比较会在合法 IdP 上间歇失败。
- discovery 地址返回 HTML（被代理/网关拦成登录页）时，在配置阶段立刻报错；此前失败会推迟很久，只表现为无法解释的"登录失败"。

---

## 4. 验证手册

被测模块只依赖 Node 内置模块，不需要 Overleaf 环境：

```sh
node --test tests/oidc-callback-url.test.mjs tests/oidc-well-known.test.mjs \
            tests/oidc-id-token.test.mjs tests/oidc-link-request.test.mjs \
            tests/oidc-email-trust.test.mjs
# 共 65 例：callback-url 13、well-known 24、id-token 13、link-request 8、email-trust 7

node --test /tests/oidc-*.test.mjs      # 镜像内
tests/verify-oidc.sh                    # 对真实提供方的往返（需要实例）
```

**只有实例能验证的**：登录流程本身、绑定确认页、账号匹配结果、以及提供方侧的回调地址白名单。本地全绿对这些一无所证。

---

## 5. 这套方案自带的坑

1. **整文件替换。** `overlay/` 下每个文件都会静默覆盖上游在该文件里的改动，因此每次升级上游都要**逐文件对账**——包括被整文件替换的 `AuthenticationController.mjs`，而它恰好是上游最容易变动的文件。
2. **不能引入新依赖**（Yarn PnP，见 §2）——这条先限制功能设计，才限制实现。
3. **提供方白名单不是代码。** 多主机部署需要在提供方登记所有回调地址（`OVERLEAF_OIDC_CALLBACK_URLS`），代码层面无法替代。
4. **延迟暴露的错误最贵。** discovery 失败与 issuer 比较这两条，症状都离真正的配置错误很远；现在都在出错点立刻报。

---

## 6. 未完成项

- 上游对账（§5.1）是人工步骤；每次升级把 overlay 与上游的 diff 一并提交会让它可复核。
- 多提供方特性（组映射、`preferred_username`）必须在依赖约束内设计。
- 端到端验证需要真实实例与真实提供方，不在 CI 范围内。
