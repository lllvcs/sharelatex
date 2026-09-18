# sharelatex-full（扩展版 Overleaf CE 镜像）

[English](README.md) | [简体中文](README.zh-CN.md)

[![GitHub license](https://img.shields.io/github/license/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/blob/master/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/lllvcs/sharelatex/build-test.yml)](https://github.com/lllvcs/sharelatex/actions/workflows/build-test.yml)
[![GitHub issues](https://img.shields.io/github/issues/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/issues)
[![Docker Pulls](https://img.shields.io/docker/pulls/lvcs/sharelatex-full)](https://hub.docker.com/r/lvcs/sharelatex-full)

基于 [tuetenk0pp/sharelatex-full](https://github.com/tuetenk0pp/sharelatex-full)
扩展的 [Overleaf 社区版](https://github.com/overleaf/overleaf) Docker 镜像。

## 功能特性

与官方 `sharelatex/sharelatex` 镜像相比，本镜像额外提供：

- 完整更新的 TeX Live 安装，包含所有可用宏包
- 额外的 TeX Live 与系统字体，包含**已随仓库内置**的中文字体集合
  （见 [`fonts/`](fonts/README.md)，构建镜像时无需联网下载字体）
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
OVERLEAF_IMAGE_NAME=lvcs/sharelatex-full
```

也可以按照
[官方说明](https://github.com/overleaf/toolkit/blob/master/doc/configuration.md#the-docker-composeoverrideyml-file)
使用 `config/docker-compose.override.yml`：

```yaml
services:
    sharelatex:
        image: lvcs/sharelatex-full
```

### 使用 Docker Compose

> [!WARNING]
> 不推荐这种方式，建议使用 Overleaf Toolkit。

使用官方仓库中的
[docker-compose.yml](https://github.com/overleaf/overleaf/blob/main/docker-compose.yml)，
把镜像改为 `lvcs/sharelatex-full` 即可。同时请留意
[官方 Wiki](https://github.com/overleaf/overleaf/wiki/Release-Notes--4.x.x#manually-setting-up-mongodb-as-a-replica-set)
中关于 MongoDB 副本集的额外说明。

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
| `OVERLEAF_OIDC_AUTHORIZATION_URL` | 发起登录流程的授权端点。 |
| `OVERLEAF_OIDC_TOKEN_URL` | 用于交换授权码的令牌端点。 |
| `OVERLEAF_OIDC_USERINFO_URL` | Userinfo 端点，其声明用于识别用户。 |
| `OVERLEAF_OIDC_CALLBACK_URL` | 在提供方注册的回调地址，即站点地址加 `/login/oidc/callback`。 |
| `OVERLEAF_OIDC_CLIENT_ID` | 在提供方注册的 Client ID。 |
| `OVERLEAF_OIDC_CLIENT_SECRET` | 在提供方注册的 Client Secret。 |
| `OVERLEAF_OIDC_SCOPE` | 请求的 scope（默认 `openid profile email`）。 |
| `OVERLEAF_OIDC_MATCHING` | 用哪个声明匹配账号：`id`（`sub` 声明，默认）或 `username`（`preferred_username` 声明）。 |
| `OVERLEAF_ENABLE_LOCAL_LOGIN` | 设为 `false` 时隐藏并禁用邮箱/密码登录（默认 `true`）。 |
| `OVERLEAF_LOGIN_INFO_TEXT` | 显示在登录表单上方的 HTML 内容（默认为 `Welcome to Overleaf! Log in to your account below.`；设为空值则不显示）。 |
| `OVERLEAF_LOGIN_OIDC_BUTTON` | SSO 按钮文字（默认 `Log in with SSO`）。 |
| `OVERLEAF_OIDC_LOGIN_IN_NAVBAR` | 设为 `true` 时在导航栏也显示 SSO 按钮（默认 `false`；禁用本地登录时始终显示）。 |
| `OVERLEAF_ENABLE_REGISTRATION` | 设为 `false` 隐藏注册页。未设置时，只要启用 OIDC 就隐藏注册页。 |

### 提供方配置

- 回调地址（Redirect URI）：`https://<你的 Overleaf 域名>/login/oidc/callback`
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

## 环境变量

官方镜像支持的所有环境变量均保持不变（参见
[Overleaf 文档](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/overleaf-toolkit-configuration)）。
本镜像新增的变量即上文 OIDC 章节中列出的那些。

## 构建镜像

### GitHub Actions

| Workflow | 触发条件 | 推送目标 |
| --- | --- | --- |
| `build-test.yml` | 向 `master` 提交 pull request、手动触发 | –（构建并运行测试） |
| `build-push-docker.yml` | 发布 release、手动触发 | Docker Hub 的 `lvcs/sharelatex-full` |
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
docker build -t sharelatex-full .
docker run --rm --volume "$(pwd)/tests:/tests" --entrypoint=/bin/bash \
    sharelatex-full -c "/bin/bash /tests/compile.sh"
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
