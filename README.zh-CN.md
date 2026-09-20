# sharelatex（扩展版 Overleaf CE 镜像）

[English](README.md) | [简体中文](README.zh-CN.md)

[![GitHub license](https://img.shields.io/github/license/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/blob/master/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/lllvcs/sharelatex/build-test.yml)](https://github.com/lllvcs/sharelatex/actions/workflows/build-test.yml)
[![GitHub issues](https://img.shields.io/github/issues/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/issues)
[![Docker Pulls](https://img.shields.io/docker/pulls/lvcs/sharelatex)](https://hub.docker.com/r/lvcs/sharelatex)

基于 [tuetenk0pp/sharelatex-full](https://github.com/tuetenk0pp/sharelatex-full)
扩展的 [Overleaf 社区版](https://github.com/overleaf/overleaf) Docker 镜像。

## 功能特性

与官方 `sharelatex/sharelatex` 镜像相比，本镜像额外提供：

- 完整更新的 TeX Live 安装，包含所有可用宏包
- 额外的 TeX Live 与系统字体，包含**已随仓库内置**的中文字体集合
  （见 [`fonts/`](fonts/README.md)，构建镜像时无需联网下载字体）
- TeX Live 的全部字体都注册到了 fontconfig，因此可以直接用**字体族名**调用；
  中文字体也按 TeX Live `zhmetrics` 度量（`uniyou20`、`unisong5b`、
  `gbkyou20` 等）所要求的文件名安装，详见[字体](#字体)
- 支持 `minted`
- 通过 inkscape 支持 `svg` 图片
- 支持 lilypond
- 默认开启 shell-escape
- **OIDC（OpenID Connect）单点登录**，详见下文

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

使用官方仓库中的
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

使用 Overleaf Toolkit 时，把以下变量加入 `config/overleaf.rc`，或写入
`config/docker-compose.override.yml`：

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
| `OVERLEAF_OIDC_ISSUER` | 提供方的 Issuer 地址，未设置时 OIDC 登录保持关闭。 |
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
递增间隔重试 5 次（合计约 30 秒）。若仍然读不到文档、或文档里缺少所需端点，原因
会写入容器日志，**OIDC 登录保持关闭，Overleaf 的其它功能照常工作**——不会因为
提供方地址写错就让整个站点不可用。

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
- 需要开放 `openid profile email` scope。Userinfo 响应必须包含 `sub` 与
  `email` 声明；如果存在 `given_name`、`family_name`、`name`、
  `preferred_username` 也会被使用。

### 行为说明

- 首次登录时按 OIDC 标识查找账号。如果该标识尚未绑定任何账号，则会把提供方
  声明的**邮箱地址**相同的已有账号绑定到该 OIDC 身份；若不存在则创建新账号，
  且邮箱直接视为已验证。
- 每次登录都会用提供方的声明同步账号的名、姓与邮箱地址。
- 由于邮箱由提供方保证，OIDC 用户不会收到「确认邮箱」提示。
- 按邮箱绑定账号的前提是提供方只声明已验证的邮箱地址。如果你的提供方允许用户
  随意设置未验证的邮箱，请先在其侧开启邮箱验证，否则用户可以通过挑选邮箱地址
  接管已有账号。
- 登录失败（例如用户取消授权）会跳回 `/login`，具体原因写入容器日志
  （`OIDC login failed`）。

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

## 环境变量

官方镜像支持的所有环境变量均保持不变（参见
[Overleaf 文档](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/overleaf-toolkit-configuration)）。
本镜像新增的变量即上文 OIDC 章节中列出的那些。

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

## 构建镜像

### GitHub Actions

| Workflow | 触发条件 | 推送目标 |
| --- | --- | --- |
| `build-test.yml` | 向 `master` 提交 pull request、手动触发 | –（构建并运行测试） |
| `build-push-docker.yml` | 发布 release、手动触发 | Docker Hub 的 `lvcs/sharelatex` |
| `build-push-ghcr.yml` | 发布 release、手动触发 | GitHub Packages 的 `ghcr.io/<owner>/<repo>` |

- **Docker Hub**：先创建仓库，然后在 *Settings → Secrets and variables →
  Actions* 中添加 `DOCKER_USER` 与 `DOCKER_PASSWORD`（Docker Hub 访问令牌）。
- **GitHub Packages**：无需任何 secret，workflow 使用内置的 `GITHUB_TOKEN`。
- **触发构建**：发布一个 release（会同时生成版本号标签与 `latest`），或在
  *Actions* 页面手动运行 workflow（镜像会以所选分支名作为标签）。

### 本地构建

构建需要 BuildKit（当前 Docker 版本的默认构建器），它用于在不额外增加镜像层的
情况下安装内置字体；旧版本 Docker 需显式启用（`DOCKER_BUILDKIT=1 docker
build ...`）。

```sh
docker build -t sharelatex .
docker run --rm --volume "$(pwd)/tests:/tests" --entrypoint=/bin/bash \
    sharelatex -c "/bin/bash /tests/compile.sh"
```

## 与上游镜像保持同步

`Dockerfile` 在官方 `sharelatex/sharelatex` 镜像之上构建，OIDC 支持以
「替换文件」的方式放在 `overlay/` 中。`Dockerfile` 会在复制 overlay **之前**
校验被替换文件的校验和：当基础镜像（或驱动基础镜像版本的上游仓库
`tuetenk0pp/sharelatex-full`）更新时，构建会直接失败，而不会把 overlay 与
新版本应用悄悄混在一起。此时请按照
[overlay/README.md](overlay/README.md) 中的步骤重新适配 overlay。

## 致谢

- [Overleaf](https://github.com/overleaf/overleaf)：Overleaf CE 本体
- [tuetenk0pp/sharelatex-full](https://github.com/tuetenk0pp/sharelatex-full)：
  本仓库的基础
- [stugen-admins/forks/overleaf-oidc](https://gitlab.informatik.uni-bremen.de/stugen-admins/forks/overleaf-oidc)：
  本次 OIDC 移植所依据的补丁
- [smhaller/ldap-overleaf-sl](https://github.com/smhaller/ldap-overleaf-sl)：
  在镜像内替换应用文件的实现思路

## 许可证

AGPL-3.0，详见 [LICENSE](LICENSE)。
