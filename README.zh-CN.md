# sharelatex（扩展版 Overleaf CE 镜像）

[English](README.md) | [简体中文](README.zh-CN.md)

[![GitHub license](https://img.shields.io/github/license/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/blob/master/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/lllvcs/sharelatex/build-test.yml)](https://github.com/lllvcs/sharelatex/actions/workflows/build-test.yml)
[![GitHub issues](https://img.shields.io/github/issues/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/issues)
[![Docker Pulls](https://img.shields.io/docker/pulls/lvcs/sharelatex)](https://hub.docker.com/r/lvcs/sharelatex)

基于 [tuetenk0pp/sharelatex-full](https://github.com/tuetenk0pp/sharelatex-full)
扩展的 [Overleaf 社区版](https://github.com/overleaf/overleaf) Docker 镜像。

## 功能特性

与官方 `sharelatex/sharelatex` 镜像相比：

**TeX Live 与编译工具链**

- 完整更新的 TeX Live 安装，包含所有可用宏包
- Overleaf 自己的 `latexmk` 配置——CE 镜像里的那份只有三行：R/knitr 文档、
  glossaries、nomenclature、`feynmf`/`feynmp`、asymptote 与 metapost 所需的
  辅助程序会被执行，*Check* 按钮可用，PDF 预览也能拿到 xref 数据——详见
  [`texlive/README.md`](texlive/README.md)
- 带 `knitr` 的 R，因此 `.Rnw`、`.Rtex` 文档也能编译
- 额外的 TeX Live 与系统字体，包含**已随仓库内置**的中文字体集合
  （见 [`fonts/`](fonts/README.md)，构建镜像时无需联网下载字体）
- TeX Live 的全部字体都注册到了 fontconfig，因此可以直接用**字体族名**调用；
  中文字体也按 TeX Live `zhmetrics` 度量（`uniyou20`、`unisong5b`、
  `gbkyou20` 等）所要求的文件名安装，详见[字体](#字体)
- fontconfig 与 LuaTeX 的字体缓存在构建镜像时就会生成，因此新容器里的首次
  编译不必再重建它们
- 支持 `minted`
- 通过 inkscape 支持 `svg` 图片
- 支持 lilypond
- 默认开启 shell-escape

**CE 镜像出厂即关闭的 Overleaf 功能**

- **带审阅面板的修订**（评论、修订区间、接受/拒绝），需手动开启，见
  [修订与审阅面板](#修订与审阅面板)
- **沙箱编译**：每个项目在自己的 TeX Live 容器里编译，需手动开启，见
  [沙箱编译](#沙箱编译)
- **OIDC（OpenID Connect）单点登录**，详见下文
- 可配置的上传上限与链接地址（linked URLs），见[环境变量](#环境变量)

## 安装

### 使用 Overleaf Toolkit

按照 [快速开始指南](https://github.com/overleaf/toolkit/blob/master/doc/quick-start-guide.md)
使用 [Overleaf Toolkit](https://github.com/overleaf/toolkit)，并在
`config/overleaf.rc` 中设置镜像：

```sh
OVERLEAF_IMAGE_NAME=lvcs/sharelatex
```

也可以按照
[官方说明](https://github.com/overleaf/toolkit/blob/master/doc/configuration.md#the-docker-composeoverrideyml-file)
使用 `config/docker-compose.override.yml`：

```yaml
services:
    sharelatex:
        image: lvcs/sharelatex
```

### 使用 Docker Compose

> [!WARNING]
> 不推荐这种方式，建议使用 Overleaf Toolkit。

使用[官方 GitHub](https://github.com/overleaf/overleaf) 中提供的
[docker-compose.yml](https://github.com/overleaf/overleaf/blob/main/docker-compose.yml)，
把镜像改为 `lvcs/sharelatex` 即可。同时请留意
[官方 Wiki](https://github.com/overleaf/overleaf/wiki/Release-Notes--4.x.x#manually-setting-up-mongodb-as-a-replica-set)
中关于 MongoDB 副本集的额外说明。

## 必需密钥：`OVERLEAF_INVITE_TOKEN_SECRET`

> [!IMPORTANT]
> 自 Overleaf 6.2.0 起，未设置该变量时容器会拒绝启动（退出码 101，并提示
> `Your configuration is missing 1 required secret(s)`）。

Overleaf 用这个密钥加密数据库中保存的分享链接令牌。与容器首次启动时自动生成的
其它内部密钥不同，它必须由你提供，并且要在重启、升级后保持不变：一旦更换，此前
生成的所有分享链接都会失效。长度不足 16 个字符的值会被拒绝。

生成方式：

```sh
openssl rand -base64 32
```

- **Overleaf Toolkit**：在 `config/variables.env` 中添加
  `OVERLEAF_INVITE_TOKEN_SECRET=<值>`，然后执行 `bin/up` 重启。
- **Docker Compose**：添加到 `sharelatex` 服务的环境变量中，然后重启容器。

## OIDC 单点登录

本镜像可以让用户通过 OpenID Connect 提供方（Keycloak、Authentik、Okta、
Azure AD 等）登录。**在配置提供方之前 OIDC 登录处于关闭状态**，因此默认行为
与原镜像完全一致。

该功能是把
[overleaf-oidc 补丁](https://gitlab.informatik.uni-bremen.de/stugen-admins/forks/overleaf-oidc)
移植到 Overleaf `6.3.0`，并以「替换镜像内文件」的方式实现，详见
[overlay/README.md](overlay/README.md)。

### 配置

使用 Overleaf Toolkit 时，请把变量加入 **`config/variables.env`**——toolkit 正是
以 env file 的形式把这个文件传给容器。注意 `config/overleaf.rc` 只被 toolkit 自己
的脚本读取，写在那里的变量**不会**进入容器。若使用原生 compose，则写进
`config/docker-compose.override.yml` 的 `environment:`/`env_file:`：

```yaml
services:
    sharelatex:
        environment:
            OVERLEAF_OIDC_ISSUER: https://idp.example.com/realms/myrealm
            OVERLEAF_OIDC_AUTHORIZATION_URL: https://idp.example.com/realms/myrealm/protocol/openid-connect/auth
            OVERLEAF_OIDC_TOKEN_URL: https://idp.example.com/realms/myrealm/protocol/openid-connect/token
            OVERLEAF_OIDC_USERINFO_URL: https://idp.example.com/realms/myrealm/protocol/openid-connect/userinfo
            OVERLEAF_OIDC_CALLBACK_URL: https://overleaf.example.com/login/oidc/callback
            OVERLEAF_OIDC_CLIENT_ID: overleaf
            OVERLEAF_OIDC_CLIENT_SECRET: <client-secret>
```

| 变量 | 说明 |
| --- | --- |
| `OVERLEAF_OIDC_ISSUER` | 提供方的 Issuer 地址（与 identity token 的 `iss` 比较时会忽略结尾的斜杠）。未设置时 OIDC 登录保持关闭。 |
| `OVERLEAF_OIDC_WELL_KNOWN_URL` | 提供方的 discovery 文档地址，或直接填 Issuer 地址——下方各端点将从该文档读取，见 [Discovery](#discovery一键配置)。 |
| `OVERLEAF_OIDC_AUTHORIZATION_URL` | 发起登录流程的授权端点。 |
| `OVERLEAF_OIDC_TOKEN_URL` | 用于交换授权码的令牌端点。 |
| `OVERLEAF_OIDC_USERINFO_URL` | Userinfo 端点，其声明用于识别用户。 |
| `OVERLEAF_OIDC_CALLBACK_URL` | 在提供方注册的回调地址。**可选**：不设置时按用户访问的网址自动生成，见[回调地址](#回调地址多域名与反向代理)。 |
| `OVERLEAF_OIDC_CALLBACK_URLS` | 多个回调地址（以逗号或空白分隔），用于同一站点有多个域名的情况。优先级高于 `OVERLEAF_OIDC_CALLBACK_URL`。 |
| `OVERLEAF_OIDC_CLIENT_ID` | 在提供方注册的 Client ID。 |
| `OVERLEAF_OIDC_CLIENT_SECRET` | 在提供方注册的 Client Secret。 |
| `OVERLEAF_OIDC_SCOPE` | 请求的 scope（默认 `openid profile email`）。 |
| `OVERLEAF_OIDC_MATCHING` | 用哪个声明匹配账号：`id`（`sub` 声明，默认）或 `username`（`preferred_username` 声明）。 |
| `OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL` | 设为 `true` 时即使提供方声明 `email_verified: false` 也信任 `email`；设为 `false` 时连「提供方未声明该字段」也不信任。见[行为说明](#行为说明)。 |
| `OVERLEAF_OIDC_LINK_MODE` | 首次登录时邮箱匹配到「尚未绑定 OIDC 的已有账号」时怎么办：`password`（默认）要求输入该账号密码后才绑定，`auto` 不询问直接绑定。见[行为说明](#行为说明)。 |
| `OVERLEAF_OIDC_JWKS_URL` | 提供方的 JWKS，用于校验 identity token。不设置时会取 discovery 文档里的 `jwks_uri`；没有它就无法校验 identity token。 |
| `OVERLEAF_OIDC_REQUIRE_ID_TOKEN` | 设为 `true` 时，提供方未返回 identity token、或未知 JWKS 的登录会被拒绝（默认 `false`：允许并记录日志）。 |
| `OVERLEAF_ENABLE_LOCAL_LOGIN` | 设为 `false` 时隐藏并禁用邮箱/密码登录（默认 `true`）。 |
| `OVERLEAF_LOGIN_INFO_TEXT` | 显示在登录表单上方的 HTML 内容（默认为 `Welcome to Overleaf! Log in to your account below.`；设为空值则不显示）。 |
| `OVERLEAF_LOGIN_OIDC_BUTTON` | SSO 按钮文字（默认 `Log in with SSO`）。 |
| `OVERLEAF_OIDC_LOGIN_IN_NAVBAR` | 设为 `true` 时在导航栏也显示 SSO 按钮（默认 `false`；禁用本地登录时始终显示）。 |
| `OVERLEAF_ENABLE_REGISTRATION` | 设为 `false` 隐藏注册页。未设置时，只要启用 OIDC 就隐藏注册页。 |

### Discovery（一键配置）

除了逐个填写端点，也可以直接使用提供方的 discovery 文档。既可以填文档地址，也
可以只填 Issuer 地址（会自动补上 `/.well-known/openid-configuration`）：

```yaml
OVERLEAF_OIDC_WELL_KNOWN_URL: https://idp.example.com/realms/myrealm
# 或者
OVERLEAF_OIDC_WELL_KNOWN_URL: https://idp.example.com/realms/myrealm/.well-known/openid-configuration
```

文档中的 `issuer`、`authorization_endpoint`、`token_endpoint`、
`userinfo_endpoint` 会被采用——**但仅在对应变量未设置时**，因此其它所有
`OVERLEAF_OIDC_*` 变量都会覆盖文档中的值。`OVERLEAF_OIDC_ISSUER` 同样可以不填：
文档里的 issuer 也会启用 OIDC 登录。

也可以**直接把文档 JSON 粘贴进变量**（值以 `{` 开头即可）——有些提供方没有说明
自己的 discovery 地址在哪里，这样省事。scope 会按提供方能力自动适配：默认的
`openid profile email` 会剔除文档 `scopes_supported` 里没有的项（`openid` 始终
请求；显式设置的 `OVERLEAF_OIDC_SCOPE` 不会被改动）——例如群晖 SSO Server 不支持
`profile`，不改就会被授权请求拒绝。

当 `OVERLEAF_OIDC_ISSUER` 以及 `OVERLEAF_OIDC_AUTHORIZATION_URL`、
`OVERLEAF_OIDC_TOKEN_URL`、`OVERLEAF_OIDC_USERINFO_URL` 都已设置时，**完全不会
去请求该文档**，这样「全部写死」的配置不依赖提供方在容器启动时可达。否则会以
递增间隔重试 5 次，并且整个重试过程还有 **60 秒的总预算**——因为它发生在 web 服务
开始监听之前，提供方不可达时启动最多延迟约一分钟，而不会拖到五次请求超时那么久。
反过来，**URL 写错会立即报错**：群晖 SSO Server 这类提供方对不存在的路径会返回它的
网页（HTTP 200 + HTML），日志里会直接写明「the endpoint answered with 'text/html',
which usually means the URL is wrong」而不去重试；HTTP 4xx 同样不重试。
若仍然读不到文档、或文档里缺少所需端点，原因
会写入容器日志，**OIDC 登录保持关闭，Overleaf 的其它功能照常工作**——不会因为
提供方地址写错就让整个站点不可用。另外仍需 `OVERLEAF_OIDC_CLIENT_ID` 与
`OVERLEAF_OIDC_CLIENT_SECRET`（discovery 文档里没有这两项）；缺少任一项时，
OIDC 登录会被关闭并记录日志，而不是让容器启动失败。

### Identity token 校验

provider 从 token 端点返回的 identity token（`id_token`）会在登录生效前校验：
签名要对得上提供方 JWKS 里的公钥（来自 discovery 文档的 `jwks_uri`，或显式设置的
`OVERLEAF_OIDC_JWKS_URL`），同时检查 `iss`、`aud`（必须包含本 client id）、
`exp`/`nbf`/`iat`（允许 60 秒时钟偏差）以及 `sub` 是否存在；签名算法只接受 RSA 与
ECDSA，`none` 和共享密钥类一律拒绝。token 的 `sub` 还必须与 userinfo 返回的 `sub`
一致，这样两份响应才被确认是同一个用户。

并非所有提供方都会返回 identity token，密钥放在别处的提供方需要显式设置
`OVERLEAF_OIDC_JWKS_URL`：**无法校验时默认允许登录并记录日志**，以免已有的部署直接
失效；设 `OVERLEAF_OIDC_REQUIRE_ID_TOKEN: true` 可以改为拒绝这类登录。反之，**一旦
返回了 token 但校验不通过，登录一律拒绝**，登录页会说明原因。本流程不发送 `nonce`，
因此也无法校验它。

### 回调地址（多域名与反向代理）

**默认无需任何配置**：回调地址由发起登录的那次请求推导而来，即
`<协议>://<用户正在访问的域名>/login/oidc/callback`。因此同一个站点即使有多个
域名也能直接工作——只需在提供方为每个域名注册一个回调地址，而回调到达时也只会
与「发起登录时所用的域名」匹配。

协议与域名取自 `X-Forwarded-Proto`、`X-Forwarded-Host` 请求头（在信任它们时），
这也是 Overleaf 的默认行为（`behindProxy`），因此反向代理应当设置这两个头。如果
没有这两个头，地址会退化为 `Host` 请求头 + `http`，若提供方要求 `https` 就会
被拒绝。

如果需要固定回调地址，有两种方式：

```yaml
# 只用一个地址（也可以只写路径），按配置原样使用
OVERLEAF_OIDC_CALLBACK_URL: https://latex.example.com/login/oidc/callback

# 每个域名一个地址
OVERLEAF_OIDC_CALLBACK_URLS: https://latex.example.com/login/oidc/callback, https://tex.example.org/login/oidc/callback
```

使用 `OVERLEAF_OIDC_CALLBACK_URLS` 时，会选用「域名与当前请求匹配」的那一条：
**当条目与请求都写了端口时按端口比较**，条目不写端口则匹配任意端口；只写路径
（例如 `/login/oidc/callback`）的条目对任何域名都生效；没有匹配到任何条目的域名，
则回退到按请求自动推导的地址（也就是未配置时的行为）。

**非标准端口。** 只要请求头里带了端口（`Host`、`X-Forwarded-Host` 或
`X-Forwarded-Port`），推导出的地址就会带上它。但 Overleaf 自带的 nginx 用
`proxy_set_header Host $host`，而 nginx 的 `$host` **会丢掉端口**；因此如果你的
站点是通过非标准端口访问（例如 `http://192.168.1.10:8080`），要么让前置代理发送
`X-Forwarded-Port`，要么把端口写进固定的回调地址里：

```yaml
OVERLEAF_OIDC_CALLBACK_URLS: http://192.168.1.10:8080/login/oidc/callback, https://latex.example.com/login/oidc/callback
```

### 提供方配置

- 回调地址（Redirect URI）：`https://<你的 Overleaf 域名>/login/oidc/callback`
  ——你使用几个域名，就注册几个（或直接使用 `OVERLEAF_OIDC_CALLBACK_URLS` 中的
  值）。
- 客户端认证方式：令牌请求把 `client_id` 与 `client_secret` 放在请求体中
  （`client_secret_post`）。
- 需要开放 `openid` 与 `email` scope（默认还会请求 `profile`，若 discovery
  文档显示提供方不支持则会自动略过）。Userinfo 响应必须包含 `sub` 与
  `email` 声明；如果存在 `given_name`、`family_name`、`name`、
  `preferred_username` 也会被使用。

### 行为说明

- **已经绑定过该 OIDC 标识的账号，直接登录**（按 `OVERLEAF_OIDC_MATCHING` 指定的
  声明查找），不再额外询问。
- **邮箱匹配到「已有但尚未绑定 OIDC」的账号时，不会直接登录。** 该 OIDC 身份会先
  暂存在会话里（10 分钟有效），用户被带到 `/login/oidc/link`，要求输入该账号的密码
  （邮箱已预填）。密码确认成功后即把 OIDC 身份绑定到该账号并完成登录；密码走的是
  标准校验流程，所以密码错误的审计、限流与提示都和普通密码登录一致。这一步正是为了
  防止「能在提供方侧随意设置邮箱的人」接管已有账号。设
  `OVERLEAF_OIDC_LINK_MODE: auto` 可跳过这一步直接绑定（即该步骤存在之前的行为），
  只有在提供方确实验证邮箱时才安全。
- **没有任何账号使用该邮箱时，创建新账号**，并把邮箱标记为已验证——前提是提供方为
  该地址背书（见下一条 `email_verified: false` 的处理）。
- 每次登录都会用提供方的声明同步账号的名与姓；邮箱地址只在提供方为其背书时才
  会改写（见下一条）。
- **只有提供方为邮箱背书时，`email` 才会被用来识别账号。** 绑定已有账号、以及
  改写账号上的邮箱地址，都要求 `email_verified: true`，或者提供方根本没有声明该
  字段（此时会在日志里写明，因为不少「确实验证了邮箱」的提供方并不返回该字段）。
  若提供方返回 `email_verified: false`，则对「已存在同邮箱账号」的登录会被拒绝
  （提示 "the identity provider did not verify this email address ..."），本地
  邮箱也不会被改写——否则能在提供方侧随意设置邮箱的人就能接管已有账号。可以设
  `OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL: true` 仍然信任这种声明，或设 `false`
  连未声明的字段也不信任。
- 由于邮箱由提供方保证，OIDC 用户不会收到「确认邮箱」提示。
- 登录失败会跳回 `/login`，并**在页面上显示原因**：提供方未验证该邮箱、该邮箱已
  绑定到另一个身份、确认流程超时、密码不匹配，或 identity token 校验失败；同时也会
  写入容器日志（`OIDC login failed`）。这些提示文字是英文的，而且页面只渲染本镜像
  已知的错误码，绝不会把提供方返回的内容直接显示出来。

## 修订与审阅面板

Overleaf 社区版其实已经带着整个功能——审阅面板、评论线程、document-updater 里的
修订区间、工具栏上的 *Review*（审阅）模式开关——但它对外报告该功能不可用，因为后端
有一个标志被硬编码为 `false`。本镜像补上了缺失的那个模块来把它翻转过来，因此该功能
与 Overleaf 上的表现一致：

```sh
OVERLEAF_ENABLE_TRACK_CHANGES=true
```

其它什么都不用做：该功能的前端本来就在 CE 镜像里，而模块注册的路由正是前端所调用的
那些。

说明：

- **默认关闭。** 打开它会改变每个项目提供的内容（多出一个面板、一个审阅模式、编辑器
  里会出现评论），所以这是一个需要你决定的事。设置该变量后重启即可。
- 只有运行中的实例才能展示的部分：某个用户所做的修改被归属到该用户名下、接受该修改
  后标记会被移除、评论线程在刷新后依然存在。`tests/verify-overlay.sh` 会在镜像内检查
  该模块是否加载、是否注册了它的路由、以及功能开关是否被打开。
- 评论保存在 chat 服务中，修改本身保存在 document-updater 中；两者都随 CE 镜像提供
  且未作改动。
- `REQ_LOCKDOWN_MODE=throw` 与该功能不兼容（也与若干核心路由不兼容）；见
  [overlay/README.md](overlay/README.md)。

## 沙箱编译

默认情况下，每个项目都在 **Overleaf 容器内部**编译，使用的是[字体](#字体)一节所述的
TeX Live 安装。所谓「沙箱编译」，是把每次编译放到一个**独立的、短生命周期的** TeX Live
镜像容器里执行。这正是 Overleaf Server Pro 提供的能力：CE 镜像已经为它做好了准备，
但没有附带 runner。

本镜像把 runner 补了回来，因此可以配合
[ayaka-notes/texlive-full](https://github.com/ayaka-notes/texlive-full) 的 TeX Live
镜像（或任何其它遵循 Overleaf 约定的镜像）使用该功能。

> [!IMPORTANT]
> 沙箱编译**不是**免费得到的加固措施：这些容器是通过 Docker socket 启动的，也就是说
> Overleaf 容器因此获得了对宿主机 Docker 守护进程的控制权。如果你想要「每个项目一个
> TeX Live 镜像」「每次编译相互隔离」，可以启用它，但不要把它当成防火墙的替代品。

### 配置

使用 Overleaf Toolkit 时，**必须设置 `SERVER_PRO=true`**——只有在该模式下 toolkit 才会
挂载 Docker socket、才会拉取 TeX Live 镜像。同时也要设置 `OVERLEAF_IMAGE_NAME`，否则
toolkit 会切换到 Server Pro 镜像：

`config/overleaf.rc`

```sh
OVERLEAF_IMAGE_NAME=lvcs/sharelatex
SERVER_PRO=true
SIBLING_CONTAINERS_ENABLED=true
DOCKER_SOCKET_PATH=/var/run/docker.sock
```

`config/variables.env`

```sh
# 每个项目可选的镜像（完整引用，逗号分隔）
ALL_TEX_LIVE_DOCKER_IMAGES=ghcr.io/ayaka-notes/texlive-full:2026.1,ghcr.io/ayaka-notes/texlive-full:2025.1
# 镜像列表里显示的名字（可选，按位置一一对应）
ALL_TEX_LIVE_DOCKER_IMAGE_NAMES=TeX Live 2026,TeX Live 2025
# 新建项目使用的镜像，必须是上面列表中的一项
TEX_LIVE_DOCKER_IMAGE=ghcr.io/ayaka-notes/texlive-full:2026.1
# clsi 编译目录的宿主机路径——兄弟容器看到的是宿主机而不是本容器，
# 所以这里必须是宿主机的路径
SANDBOXED_COMPILES_HOST_DIR_COMPILES=/absolute/path/to/data/overleaf/data/compiles
SANDBOXED_COMPILES_HOST_DIR_OUTPUT=/absolute/path/to/data/overleaf/data/output
SANDBOXED_COMPILES_HOST_DIR_CACHE=/absolute/path/to/data/overleaf/data/cache
```

这三个 `SANDBOXED_COMPILES_HOST_DIR_*` 取值就是 toolkit 的
`${OVERLEAF_DATA_PATH}/data/...`，写成绝对路径即可（toolkit 自己的
`lib/docker-compose.sibling-containers.yml` 只设置了 `SANDBOXED_COMPILES_HOST_DIR`）。

原生 `docker compose` 部署需要同样的环境变量，另外还要挂载 socket：

```yaml
services:
    sharelatex:
        volumes:
            - /var/run/docker.sock:/var/run/docker.sock
```

### 它做了什么

- 镜像列表会出现在项目设置里，项目会一直保留创建时所用的镜像；之后改动它，就会用新
  镜像重新编译。
- 新项目从 `TEX_LIVE_DOCKER_IMAGE` 开始。此前创建的项目没有记录镜像，它们会在默认
  镜像里编译，而默认镜像同样是 `TEX_LIVE_DOCKER_IMAGE`（如果希望数据库里明确写出来，
  可以执行 `bin/run-script scripts/backfill_project_image_name.mjs`）。
- 编译容器以 `--network none`、`--cap-drop ALL`、`no-new-privileges` 以及镜像自带的
  seccomp 配置运行，并且使用拥有编译目录的 `www-data` uid
  （当 `SANDBOXED_COMPILES_SIBLING_CONTAINERS=true` 时，
  `server-ce/config/env.sh` 会替你设置 `TEXLIVE_IMAGE_USER`）。

### 容易出错的地方

- **镜像 tag 必须以 TeX Live 年份开头**（`2026.1`、`2025.1`）。runner 会用 tag 拼出编译
  容器里的 `PATH`；一个 tag 为 `6.3.0` 的镜像会被读成「TeX Live 6」，于是每次编译都
  找不到 `latexmk`。这也是 `lvcs/sharelatex` 自身不能用作编译镜像的原因。
- **`ALL_TEX_LIVE_DOCKER_IMAGES` 与 `TEX_LIVE_DOCKER_IMAGE` 必须一致**：每个镜像都要
  位于同一个 registry 前缀之下，并且当前镜像必须在列表里。不符合的配置会在 web 服务
  启动时报出来，并指明哪里不对。
- **seccomp 配置很重要。** 当这份配置对 TeX Live 镜像来说太旧时，`minted` 会因权限错误
  失败（texlive-full 随附的那份比属于本 clsi 的那份更小）。镜像随附的是与自身 clsi
  匹配的那份。
- Overleaf CE 会跳过自己的 TeX Live 预检（`check-texlive-images.mjs` 只在
  `OVERLEAF_IS_SERVER_PRO=true` 时运行），因此镜像名写错会在第一次编译时暴露，而不是
  在启动时。

## 字体

镜像包含 TeX Live 安装（`scheme-full`，即 CTAN 字体归档中所有有 TeX Live 宏包
的字体）、TeX Live 本身不含的系统字体（Noto CJK、文泉驿、文鼎 Uming/Ukai、
Unifont、IPA/Un、Liberation、Carlito/Caladea 等），以及 `fonts/`
（见 [`fonts/`](fonts/README.md)）中内置的字体集合。

「装上了」和「能用」之间的差距由 `Dockerfile` 中的三件事弥合：

- **把 TeX Live 字体注册到 fontconfig。** 否则这些字体只能按**文件名**调用
  （`\setCJKmainfont{FandolSong-Regular.otf}`）：按**字体族名**调用
  （`\setCJKmainfont{FandolSong}`）要经过 fontconfig。镜像为
  `texmf-dist/fonts/{opentype,truetype}` 添加了 fontconfig 配置，覆盖整个
  TeX Live 字体集合——XeLaTeX/LuaLaTeX 文档以及 inkscape 都能按名字使用。
- **为 `zhmetrics` 度量补上字形文件。** TeX Live 的 `zhmetrics` 宏包只含度量
  （`uniyou20`、`unisong5b`、`gbkyou20` 等），字形来自生成这些度量的 Windows
  字体。内置字体因此会以该映射所要求的文件名再安装一份（`simyou.ttf`、
  `simsun.ttc`、`simhei.ttf`、`simkai.ttf`、`simfang.ttf`、`simli.ttf`），并且
  该映射被全局启用：使用这些字体族的文档在 **pdfLaTeX** + `CJK`/`CJKutf8`
  下无需自己 `\input zhwinfonts` 即可编译。
- **构建期校验。** 用 `kpsewhich` 检查两类字体的度量与字形文件是否都在，并用
  pdfTeX 编译一小段文档，确认 `zhmetrics` 映射确实生效（映射缺失正是真实文档里
  「Font uniyou20 not found」的根源）。fontconfig 的字体族名会一并打印出来，
  按族名选择字体的 XeLaTeX 示例 `tests/fonts-by-name` 则由 CI 在构建出的镜像里
  实际编译。

说明：

- CTeX 的纯 Unicode 字体集（`fontset=fandol`、`fontset=founder`、
  `fontset=mac` 等）必须使用 **XeLaTeX 或 LuaLaTeX**；在 pdfLaTeX 下 CTeX 会
  按设计报「fontset 不可用」。`fandol` 属于 TeX Live，用 XeLaTeX/LuaLaTeX 即可。
- `tests/fonts-zhmetrics` 与 `tests/fonts-by-name` 是这两种用法的示例，CI 会在
  镜像内实际编译它们。
- 内置的微软/苹果/Adobe 字体不可再分发，许可证情况见
  [`fonts/README.md`](fonts/README.md)。
- **字体缓存。** 两个字体缓存都在构建镜像时生成（`fc-cache -fsv` 与
  `luaotfload-tool --update`），否则新容器里的首次编译都会重建 LuaTeX 的字体名
  数据库——慢到看起来像文档卡住了。LuaTeX 缓存是**故意**写进 TeX Live 目录树的：
  `TEXMFVAR` 指向 `/var/lib/overleaf`，而部署时会把它挂载为卷，因此构建期写在
  那里的东西在运行期是看不到的。
- **`OSFONTDIR`** 在 `texmf.cnf` 中设置，作为除 fontconfig 配置之外访问系统字体的
  第二条途径；同时 Type1 字体对 fontconfig 隐藏（XeTeX 无法内嵌它们，还会因此
  出错）。

## 环境变量

官方镜像支持的所有环境变量均保持不变（参见
[Overleaf 文档](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/overleaf-toolkit-configuration)）。
本镜像新增的变量如下：

### 登录

见上文 [OIDC 章节](#oidc-单点登录)：`OVERLEAF_OIDC_ISSUER`、
`OVERLEAF_OIDC_WELL_KNOWN_URL`、`OVERLEAF_OIDC_AUTHORIZATION_URL`、
`OVERLEAF_OIDC_TOKEN_URL`、`OVERLEAF_OIDC_USERINFO_URL`、
`OVERLEAF_OIDC_CALLBACK_URL(S)`、`OVERLEAF_OIDC_CLIENT_ID`、
`OVERLEAF_OIDC_CLIENT_SECRET`、`OVERLEAF_OIDC_SCOPE`、`OVERLEAF_OIDC_MATCHING`、
`OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL`、`OVERLEAF_OIDC_LINK_MODE`、
`OVERLEAF_OIDC_JWKS_URL`、`OVERLEAF_OIDC_REQUIRE_ID_TOKEN`、
`OVERLEAF_ENABLE_LOCAL_LOGIN`、`OVERLEAF_LOGIN_INFO_TEXT`、
`OVERLEAF_LOGIN_OIDC_BUTTON`、`OVERLEAF_OIDC_LOGIN_IN_NAVBAR`、
`OVERLEAF_ENABLE_REGISTRATION`。

### 功能

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `OVERLEAF_ENABLE_TRACK_CHANGES` | `false` | 设为 `true` 即开启修订与审阅面板，见[修订与审阅面板](#修订与审阅面板)。 |
| `SANDBOXED_COMPILES` | `false` | 设为 `true` 即把每个项目放到自己的 TeX Live 容器里编译，见[沙箱编译](#沙箱编译)。 |
| `ALL_TEX_LIVE_DOCKER_IMAGES` | – | 项目可以用来编译的镜像，写完整引用，以逗号分隔。与 `SANDBOXED_COMPILES` 一起使用时必填。 |
| `ALL_TEX_LIVE_DOCKER_IMAGE_NAMES` | 镜像名本身 | 镜像列表里显示的名称，以逗号分隔、按位置对应。名称中可以有空格。 |
| `TEX_LIVE_DOCKER_IMAGE` | – | 新项目默认使用的镜像。与 `SANDBOXED_COMPILES` 一起使用时必填，且必须是 `ALL_TEX_LIVE_DOCKER_IMAGES` 中的一项。其 tag 必须以 TeX Live 年份开头。 |
| `IMAGE_ROOT` | 由第一个镜像推导 | 与项目的裸镜像名一起保存的 registry 前缀。仅在无法推导时才需要设置，而且此时每个镜像都必须位于该前缀之下。 |
| `SANDBOXED_COMPILES_HOST_DIR_COMPILES` | – | clsi 进行编译的目录在宿主机上的路径。与 `SANDBOXED_COMPILES` 一起使用时必填（缺少它 clsi 会拒绝启动）。 |
| `SANDBOXED_COMPILES_HOST_DIR_OUTPUT` | – | 输出目录在宿主机上的路径，用于把输出写到别处的编译。 |
| `SANDBOXED_COMPILES_HOST_DIR_CACHE` | – | clsi 缓存在宿主机上的路径，以便做 PNG 转换的容器能够访问到它。 |
| `SANDBOXED_COMPILES_SIBLING_CONTAINERS` | `false` | 在单容器部署中设为 `true`；它让容器以 `www-data` 身份运行编译容器，而 `www-data` 正是编译目录的所有者。由基础镜像处理。 |
| `MAX_UPLOAD_SIZE` | `50` | 上传上限，单位为**兆字节**。zip 因内容解压后过大而被拒绝的那个阈值也随之提高（是该上限的六倍，且不低于官方镜像允许的 300 MB）。 |
| `ENABLED_LINKED_FILE_TYPES` | 空 | 提供哪些链接文件类型，以逗号分隔（`url`、`project_file`、`project_output_file`）。使用 `url` 时，本镜像还会把 CE 镜像运行却从未指向的 linked-URL 代理配置好，使链接地址真正可用。 |
| `LINKED_URL_PROXY_HOST` | `127.0.0.1` | linked-URL 代理的主机，用于各服务运行在独立容器中的部署。 |
| `OVERLEAF_CONFIG` | `/etc/overleaf/settings.overlay.cjs` | 容器的设置文件。它会加载并扩展基础镜像的那一份；**替换它同时也会移除本镜像的模块注册**——见 [overlay/README.md](overlay/README.md)。 |

## 常见疑问

### 日志里这些不是错误

- 每次启动都出现的
  `err={"message":"The \`punycode\` module is deprecated ...","code":"DEP0040"}`
  与 `msg=Warning details`：这是**上游依赖**的弃用警告（Node 24 对内置 `punycode`
  模块的提示）。Overleaf 的 logger 会把 `process` 警告也写到错误通道，所以看起来
  像报错，实际不影响功能。若不想看到它，可加 `NODE_OPTIONS=--no-deprecation`
  （例如写进 toolkit 的 `config/variables.env`）。
- 一行里挤了多个时间戳和一段 JSON：这是容器把多个进程的日志写进同一输出流的
  交错现象，内容本身没问题。
- `*** Running /etc/my_init.pre_shutdown.d/00_close_site ...`：这是容器**被停止**
  时的收尾流程，不是崩溃。
- `OIDC: OVERLEAF_OIDC_JWKS_URL is not set and the provider published no
  jwks_uri ...`：这是关于 identity token 的警告，不是启动失败；见
  [Identity token 校验](#identity-token-校验)。

### 只有第一次编译慢

那是字体缓存，不是文档本身：见[字体](#字体)。它出现在构建镜像时漏掉了
`luaotfload-tool --update` 这一步的情况下，而构建过程会校验这一点。

### SyncTeX 很慢（每次点击 20-30 秒）

已知问题（[overleaf/overleaf#1150](https://github.com/overleaf/overleaf/issues/1150)）：
当部署的 TLS 终结端使用 HTTP/2 时，只有 SyncTeX 请求会卡住。这不是本镜像能改的
——容器内的 nginx 只讲 HTTP/1.1——因此请从反向代理的 `listen` 指令里去掉 `http2`。

### 该有的功能却没有

检查设置文件在启动时打印的那行日志（`settings.overlay:`）——它会列出已开启的模块。
如果这行日志完全没有出现，说明 `OVERLEAF_CONFIG` 被覆盖了，而覆盖它会替换本镜像的
设置文件，模块注册也随之丢失。

## 构建镜像

### GitHub Actions

| Workflow | 触发条件 | 推送目标 |
| --- | --- | --- |
| `build-test.yml` | 向 `master` 提交 pull request、手动触发 | –（构建并运行测试） |
| `docker-build.yml` | 发布 release、手动触发 | GitHub Packages 的 `ghcr.io/<owner>/<repo>`，标签为 `<channel>-<短哈希>`（交接用的镜像） |
| `docker-publish.yml` | 手动触发 | 把上面的镜像复制到 Docker Hub 的 `lvcs/sharelatex`，并在两个 registry 上移动 `latest`/`<channel>`/`<version>` 标签 |

- **Docker Hub**：先创建仓库，然后在 *Settings → Secrets and variables →
  Actions* 中添加 `DOCKER_USER` 与 `DOCKER_PASSWORD`（Docker Hub 访问令牌）。
- **GitHub Packages**：无需任何 secret，workflow 使用内置的 `GITHUB_TOKEN`。
- **先构建、后发布**：`docker-build.yml` 只把镜像**构建一次**并推送到 GHCR，标签
  为不可变的 `<channel>-<短哈希>`（冷构建需要几十分钟）；`docker-publish.yml` 把
  这个镜像在 registry 之间直接复制到 Docker Hub，并移动
  `latest`/`<channel>`/`<version>` 标签——耗时数秒，不会重新构建。发布 release 会
  自动触发构建，也可以在 *Actions* 页面手动运行任意一个 workflow。两个 registry 上
  的镜像都会由发布会话用 cosign 签名。

### 本地构建

构建需要 BuildKit（当前 Docker 版本的默认构建器），它用于在不额外增加镜像层的
情况下安装内置字体；旧版本 Docker 需显式启用（`DOCKER_BUILDKIT=1 docker
build ...`）。

```sh
docker build -t sharelatex .
# 镜像内的 overlay 自检：模块、设置、TeX Live 配置
docker run --rm --volume "$(pwd)/tests:/tests" --entrypoint=/bin/bash \
    sharelatex -c "/bin/bash /tests/verify-overlay.sh"
# 最小可编译示例
docker run --rm --volume "$(pwd)/tests:/tests" --entrypoint=/bin/bash \
    sharelatex -c "/bin/bash /tests/compile.sh"
```

不需要镜像的模块测试也可以在宿主机上运行：

```sh
node --test tests/oidc-*.test.mjs tests/overlay-settings.test.mjs \
            tests/sandboxed-compiles-images.test.mjs
```

## 与上游镜像保持同步

`Dockerfile` 在官方 `sharelatex/sharelatex` 镜像之上构建，OIDC 支持以
「替换文件」的方式放在 `overlay/` 中。`Dockerfile` 会在复制 overlay **之前**
校验被替换文件的校验和：当基础镜像（或驱动基础镜像版本的上游仓库
`tuetenk0pp/sharelatex-full`）更新时，构建会直接失败，而不会把 overlay 与
新版本应用悄悄混在一起。此时请按照
[overlay/README.md](overlay/README.md) 中的步骤重新适配 overlay。

overlay 还在三处依赖 CE 镜像的*形态*，而这些地方可能因基础镜像更新而变化；构建会
检查它们，失败时打印一条说明该做什么的消息：

- 校验和受检查的那两个文件（`AuthenticationController.mjs`、`router.mjs`）；
- `services/clsi/app/js/CommandRunner.js` 必须导入 Docker runner（overlay 以某个
  release 可能使用的两个名字提供了它）；
- `Dockerfile` 追加内容的那些 TeX Live 配置文件，以及编译工具链所调用的程序。

## 致谢

- [Overleaf](https://github.com/overleaf/overleaf)：Overleaf CE 本体，以及
  `texlive/LatexMk`、`run-chktex.sh` 与 `patchSynctex.R`
- [tuetenk0pp/sharelatex-full](https://github.com/tuetenk0pp/sharelatex-full)：
  本仓库的基础
- [ayaka-notes/ayakaleaf-pro](https://github.com/ayaka-notes/ayakaleaf-pro)：
  修订模块与 clsi 的 Docker runner，以及对「CE 镜像保留了什么、移除了什么」的分析
- [ayaka-notes/texlive-full](https://github.com/ayaka-notes/texlive-full)：
  TeX Live 工具链文件与预先生成的字体缓存
- [stugen-admins/forks/overleaf-oidc](https://gitlab.informatik.uni-bremen.de/stugen-admins/forks/overleaf-oidc)：
  本次 OIDC 移植所依据的补丁
- [smhaller/ldap-overleaf-sl](https://github.com/smhaller/ldap-overleaf-sl)：
  在镜像内替换应用文件的实现思路

## 许可证

AGPL-3.0，详见 [LICENSE](LICENSE)。
