# Overleaf CE（sharelatex）分支 — 开发记录

> **这份文件是什么。** 记录本分支如何给 Overleaf CE 添加功能、以及构建过程中真实发生过什么：实现结构、塑造了它的那些发现、此后做出的安全决定、现有的验证手段、以及这套方案自带的坑。写给**准备改它、想要历史而不是规则**的开发者。
>
> 从这些记录里提炼出的**规则**在 [`DEVELOP_SKILL.MD`](./DEVELOP_SKILL.MD)（英文，面向 agent）。配置与部署**用法**见 [`README.md`](./README.md) / [`README.zh-CN.md`](./README.zh-CN.md)。

- 做法：**不重建 Overleaf**——`overlay/` 里是完整替换文件与新增文件，被复制进 `sharelatex/sharelatex` 镜像；Overleaf 直接运行这些源码，没有编译步骤。
- 上游基线：Overleaf CE `6.3.0`；发布镜像 `lvcs/sharelatex`
- 参考来源：overlay 机制来自 `smhaller/ldap-overleaf-sl`；OIDC 实现由 `stugen-admins/forks/overleaf-oidc` 移植；修订模块与 clsi 的 Docker runner 由 `ayaka-notes/ayakaleaf-pro` 移植；TeX Live 工具链文件与字体缓存相关工作来自 `ayaka-notes/texlive-full`。

---

## 1. 改动清单

OIDC 部分，按提交：

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

第二轮——从 `ayakaleaf-pro-server-pro` 与 `texlive-full-main` 移植——按领域划分（推理见 §3–§5）：

| 领域 | 内容 |
| --- | --- |
| 修订功能 | `modules/track-changes/**`（3 个文件）+ `OVERLEAF_ENABLE_TRACK_CHANGES` |
| 沙箱编译 | `modules/sandboxed-compiles/**`、`services/clsi/app/js/DockerRunner.js`、`DockerLockManager.js`、`DockerRunner.mjs`（shim）、`services/clsi/seccomp/clsi-profile.json` |
| 设置 | `etc/overleaf/settings.overlay.cjs`、`etc/overleaf/overlay-modules.cjs`、`ENV OVERLEAF_CONFIG`、`MAX_UPLOAD_SIZE`、linked-URL 代理 |
| 编译工具链 | `texlive/LatexMk`、`texlive/run-chktex.sh`、`texlive/patchSynctex.R`、R + knitr + stringr、ghostscript、qpdf、gnuplot、python3-pygments、`time`、`LANG=C.UTF-8` |
| TeX Live 配置 | `openout_any`/`openin_any`、`OSFONTDIR`、fontconfig 中拒绝 Type1、`luaotfload-tool --update`、`fc-cache -fsv`、essential 宏包兜底 |
| 验证 | `tests/verify-overlay.sh`（原 `verify-oidc.sh`）、`tests/overlay-settings.test.mjs`、`tests/sandboxed-compiles-images.test.mjs`、`tests/knitr` |

---

## 2. 实现结构

Overleaf 把后端以普通 ESM 源码形式放在镜像里（`app/src/**/*.mjs`、`modules/**/*.mjs`、`app/views/**/*.pug`），所以**替换镜像内这些文件**即可改变行为、无需触碰构建流程。overlay 因此包含：

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

以及 overlay 之外的部分：

| 路径 | 职责 |
| --- | --- |
| `services/web/modules/track-changes/**` | 修订与审阅面板 |
| `services/web/modules/sandboxed-compiles/**` | 项目的 TeX Live 镜像设置 |
| `services/clsi/app/js/DockerRunner.{js,mjs}`、`DockerLockManager.js` | 编译容器的 runner |
| `services/clsi/seccomp/clsi-profile.json` | 编译容器的 seccomp 配置 |
| `etc/overleaf/settings.overlay.cjs`、`overlay-modules.cjs` | `OVERLEAF_CONFIG` 所指向的文件 |

**决定实现形态的约束：** 镜像用 **Yarn PnP** 安装依赖，overlay 从不重装依赖——**新包无法解析**。上游补丁依赖 `@govtechsg/passport-openidconnect`，本分支改为基于镜像已有的 `passport-oauth2` 自写策略。任何 import 都必须是 Node 内置模块或镜像里已有的包。第二轮挑选这两个移植对象，部分原因正是它们满足这条：Docker runner 需要 `dockerode`、`async` 与 `lodash`，而 `services/clsi/package.json` 已经声明了它们；修订模块需要 `p-limit`，`@overleaf/web` 也已经声明。

---

## 3. CE 镜像保留了什么、移除了什么

整个第二轮都建立在这个发现之上，而且它反直觉，值得直说：**CE 镜像并不是一个更小的应用，它就是同一个应用，只是被拿掉了三样东西。**

与恢复了 Server Pro 功能的分支（`ayaka-notes/ayakaleaf-pro`）对比：

| 层次 | CE 保留 | CE 移除 |
| --- | --- | --- |
| `services/web/app/src` | **全部**，除两个文件外与该分支逐字节相同（见 §6） | — |
| `services/web/modules` | 5 个模块 | 另外 18 个（全部 Pro/SaaS 功能） |
| `services/web/config/settings.defaults.js` | 所有*读取*设置的代码 | Pro 设置的默认值，以及模块列表 |
| `services/web/frontend` | 整个 UI 的源码，包括 Pro 界面 | 无（被门控的并不是前端） |
| `services/clsi` | 除两个文件之外的全部 | `DockerRunner.js`、`DockerLockManager.js`、`seccomp/` |

由它推出的结论，正是这些移植得以成立的原因：

- **设置就是现成的开关。** `Settings.enableGitBridge`、`allowedImageNames`、`imageRoot`、`currentImageName`、`apis.linkedUrlProxy`、`trackChangesAvailable` 等等，都被 CE 核心代码读取，而这些代码并没有给它们默认值。把设置写上就够了。这也是原生 CE 部署无法提供 linked URL 的原因：尽管镜像里跑着 `linked-url-proxy` 服务，`UrlHelper` 仍会抛 `no linked url proxy configured`。
- **模块目录就是启用单位。** `Modules.loadModulesImpl()` 对 `Settings.moduleImportSequence` 的每一项 import `modules/<name>/index.mjs`，此外什么都不做——不扫描目录、不自动发现、没有构建步骤。加一个目录加一个名字，就激活了一个功能。
- **用户界面才是运行时加不上的那部分。** 模块贡献的组件是通过 `Settings.overleafModuleImports` 被拉进 webpack 构建的，而它由 Babel 宏**在构建期**解析。运行时的设置无法给已经打好的包补上 import。正是这一点把可移植的功能与其余功能分开：

  | 功能 | 可移植 / 不可移植的原因 |
  | --- | --- |
  | 修订、审阅面板 | UI 是*核心*前端源码，通过项目载荷里的 `trackChangesVisible` 字段触达——不需要注册表项 |
  | 沙箱编译 | 自身没有 UI；镜像选择器属于核心 |
  | 登录（任何形式）、注册 | 核心视图 |
  | AI 助手（workbench）、错误助手、管理面板、模板库、Git bridge、GitHub 同步、Zotero/Mendeley、个人访问令牌、open-in-overleaf | 组件是登记在 `overleafModuleImports` 里的模块前端文件——**不在打包产物中**，所以功能触达不到 |
  | 符号面板、Python runner、reference picker | 模块*本身就是*前端：它们的 `index.mjs` 不注册任何路由、钩子或设置，存在的唯一意义是给注册表一个可以指向的东西。加进来等于什么都没改 |
  | `learn`（文档镜像） | 纯后端，且 import 都能解析，因此是被否决的候选中唯一*本来能跑*的——但该模块会在**服务器启动期间**抓取并缓存上游 wiki 的全部页面，没有超时，而且是在开始接受请求之前 |
  | LDAP、该分支自带的 OIDC 模块 | **不移植，既是约束也是决定。** 两者还额外被挡住（`ldapjs` 与 `passport-openidconnect` 并未被 `@overleaf/web` 声明，PnP 会拒绝该 import，整个 web 服务都起不来），但这个决定本身就站得住：本分支的 OIDC 支持才是这里实际在用、并且经过加固的那一套（§6），而那个分支的模块会注册*第二个* `oidc` 策略，自带 `/oidc/login` 路由和自己的 `Settings.oauthProviders`，它会与 `/login/oidc` 冲突，而不是扩展它 |
  | `authentication/saml` | 可以解析——`@node-saml/passport-saml` 已被声明且有 patch——但它自带一套登录/登出路由，会与 OIDC overlay 的冲突；而且该分支依赖的 `@node-saml/node-saml` patch 在本镜像里*没有*应用，所以上线前无法验证其行为 |
  | `login-register` 的 `@domain` 注册限制 | 该模块整体替换了登录与注册页面，而本分支已经为 OIDC 替换过它们；其中只有「注册仅限某个邮箱域名」这一项检查能带来增量，而它应当放进核心注册控制器，而不是再造第二套 |

  AI 这一例值得完整记下来，因为它正是最多人问的那个：镜像*确实*声明了 `ai@6`、`@ai-sdk/openai`、`@ai-sdk/google-vertex`、`@ai-sdk/mcp` 与 `zod`，所以在替换掉一个 import（`@ai-sdk/openai-compatible` 里的 `createOpenAICompatible`，而它只是一个传递依赖）之后，后端是能跑起来的。但它依然触达不到，因为聊天面板、错误助手组件以及触发它们的编辑器扩展都被编译进了打包产物。

  **「前端是冻结的」到底冻到哪一步——实测。** 镜像是直接从 registry 读取的（方法记录在
  `.research/image-inspection/`），而答案比「UI 不见了」更有意思：

  | 内容 | 在镜像里吗？ |
  | --- | --- |
  | `services/web/frontend/`（整个 UI 源码） | 在，2367 个条目 |
  | `webpack.config*.js`、`frontend/macros/import-overleaf-module.macro.js` | 在 |
  | `public/js/*.js` 与 `public/manifest.json`（打包产物） | 在 |
  | `overleaf/.pnp.cjs` | 在，1.19 MB |
  | 那份 PnP 映射里的 webpack **工具链** | **不在**——构建之后 devDependencies 被裁掉了（`genScript.js` 的编译步骤以 `yarn workspaces focus --all --production` 结尾） |
  | 那些被裁掉的包的 **yarn 缓存** | 大体上在（2829 个 zip，包含 webpack 的各个 loader 与 `@babel/*`） |

  而打包产物自己的 `public/manifest.json` 有 41 个 entrypoint，其中恰好两个属于模块
  （`modules/launchpad/pages/launchpad`、`modules/user-activate/pages/user-activate-page`）。
  所以那些功能的 UI 确实不在镜像里，而在**不重新构建**的前提下把它打开，得到的并不是
  一个空白页面——`ExpressLocals.getWebpackAssets()` 会去索引
  `webpackManifest.entrypoints[entrypoint].assets`，于是一个未知的 entrypoint 就是一个
  **HTTP 500**，这比功能缺席更糟。

  重新构建是可行的，上游就是这么做的：
  `OVERLEAF_CONFIG=<一份把注册表填好的设置文件> yarn run
  webpack:production`，前提是先用 `yarn install` 从缓存里把 devDependencies 恢复回来。
  代价是：镜像构建时间大幅拉长、打包产物每次上游升级都要重新生成，而且——专就 AI 模块
  而言——还要替换一处 import，再加一个要指向的 AI 网关。它也很容易悄无声息地做错：
  不带 `OVERLEAF_CONFIG` 跑 webpack，读到的就是镜像自己那份全空的注册表，于是产出
  一份同样空的打包产物，**而构建仍然是绿的**。如果本仓库哪天真的接手前端重建，那就是
  转折点；这不是 overlay 能做的事。
- **模块列表里的顺序很关键。** 该序列是用 `await import()` 逐个走的，因此只要有一个模块的 import 解析不了，`loadModules()` 就会中断，web 服务根本起不来。只能加入已知能解析的模块。

### 3.1 只有镜像本身才能定论的事

overlay 的假设里有五条是拿**已发布镜像**（而不是源码树）核对的，其中一条是错的：

| 假设 | 结果 |
| --- | --- |
| 编译 runner 是 `DockerRunner.js`，而且 clsi 检查的是同一个名字 | 确认——`CommandRunner.js` import 它，`config/settings.defaults.cjs:133` 会 stat 它，而这两个文件都不在镜像里 |
| `/usr/local/share/latexmk/LatexMk` 是三行桩文件 | 确认（125 字节），所以替换它是纯获益 |
| `qpdf` 与 `time` 已经装好，而 `ghostscript`/`Rscript`/`gnuplot`/`chktex`/`inkscape`/`lilypond` 没有 | 确认 |
| TeX Live 位于 `/usr/local/texlive/<year>`，`/usr/share/fonts` 里只有 DejaVu | 确认（2026） |
| **`server-ce/config/env.sh` 会为兄弟编译设置 `TEXLIVE_IMAGE_USER`** | **对 6.3.0 来说是错的。** 镜像里的 `env.sh`（383 字节）只有那几个 `*_HOST` 导出；那段分支存在于 `main`，不在这里。于是 clsi 会以 `tex`（uid 1000）启动编译容器，而编译目录属于 `www-data`（uid 33），每次沙箱编译都会因权限错误失败。overlay 现在自行设置 `Settings.clsi.docker.user` |

最后一行正是这次下载镜像去做检查的价值所在：这是一个只有在真实部署里、挂载了 socket、
真正跑一次编译时才会暴露的失败。

### 3.2 重建前端（可选步骤）

上面的核对留下了一个悬而未决的问题：如果源码都在、只是工具链被裁掉了，重建到底能不能
成功？答案现在已经作为一条可选构建步骤进了仓库，并用「能证明这件事的最小功能」做了
验证。

**为什么选 `symbol-palette`。** 它的 `index.mjs` 只有四行：打一行日志、导出一个空对象
——没有路由、没有钩子、没有设置。这个功能*本身*全在它的前端里，通过一个注册表键
（`sourceEditorSymbolPalette`，由核心的 `symbol-palette-pane.tsx` 渲染）挂进去。因此
它是唯一一个「整体效果就等于证明注册表与打包产物一致」的模块——而它的依赖只有已声明的
软件包（`react`、`react-i18next`、`match-sorter`、`prop-types`，都是 `yarn install`
会恢复的 devDependencies），外加五个上游本来就有的 `@/` 核心前端文件。除此之外什么都
不需要移植。

**这一步做了什么**，在 `Dockerfile` 里，由
`--build-arg OVERLEAF_REBUILD_FRONTEND=true` 打开：

1. `yarn install --immutable` 恢复被裁掉的 devDependencies。镜像里的 yarn 缓存含有其中
   大部分，而构建过程可以联网，所以这是三步里风险最低的一步。
2. `OVERLEAF_CONFIG=…/config/settings.frontend.cjs yarn run webpack:production`
   用填好的注册表编译前端。这个设置文件*不是*运行时的那一个：宏只在 webpack 启动时读
   一次 `@overleaf/settings`。
3. `yarn workspaces focus --all --production` 再把 devDependencies 裁掉，因此跑起来的
   镜像和之前完全一样——这也正是上游自己的构建所做的。

**那个坑，也是这个设置文件存在的唯一理由。** 不带 `OVERLEAF_CONFIG` 跑 webpack，它会去
读镜像自己的 `services/web/config/settings.defaults.js`，而那份文件里除了三个
`full-project-search` 的键之外，每个键的注册表都是 `[]`。结果是**逐字节等价**的空打包
产物，**而构建仍然是绿的**。这正是要针对设计的失败模式，所以校验检查的是*产物*，而不是
命令：

- `tests/verify-overlay.sh` 在 `public/js` 里找该模块的组件（找的是它的一个 CSS 类名，
  而 CSS 是抽到别处去的，所以能找到就说明该模块的 JavaScript 被打进去了），并检查重建
  后的 manifest 里核心入口仍然在——这两个错误的方向正好相反。
- `tests/frontend-rebuild.test.mjs` 检查设置文件本身：核心前端所问的那个键、路径能解析、
  路径写成相对形式（这样它被复制到 `/overleaf/services/web` 之后依然有效），以及镜像
  校验所 grep 的那个字符串仍在组件里。
- `.github/workflows/build-test.yml` 是**带这个参数**构建的，所以 CI 才是证明整条路径
  可用的地方；`docker-build.yml` 同样带它，因为模块贡献的用户界面只存在于重建过的打包
  产物里。不带这个参数构建出来的镜像，功能的路由都在、界面却不在——这种失败模式看起来
  像前端坏了，而不像少传了一个构建参数，所以两个 workflow 都带上它，并由
  `tests/verify-overlay.sh` 事后检查组件确实在打包产物里。

**它跑起来究竟做了什么**，2026-10-05 对着真实镜像实测（28 核、用基础镜像自带的 yarn
缓存、安装过程不需要联网）：

| 步骤 | 结果 |
| --- | --- |
| `yarn install --immutable` | 15 秒，全部来自 `/overleaf/.yarn/cache`——缓存确实留住了被裁掉的 devDependencies |
| `yarn run webpack:production` | 35 秒，464 个 JS 资源，写出 `manifest.json` |
| 设置文件 | 先 `Using settings from /overleaf/services/web/config/settings.frontend.cjs`，紧接着 `Detected change in overleafModuleImports, purging babel cache!`——注册表确实是在该读的地方被读到的 |
| 打包产物 | 41 个入口，与基础镜像 manifest 里的完全相同，**外加**在 `public/js/pages/ide-*.js` 里找到了该模块的组件 |
| `yarn workspaces focus --all --production` | 再次裁掉 devDependencies；跑起来的镜像不变 |

所以重建确实可行，这套机制不再是假设。它*没有*回答的是：调色板在浏览器里渲染是否
正确——那需要跑起一个实例，而不是做一次构建。

**它的代价**，以及为什么不做默认：镜像构建多出一次 `yarn install` 和一次生产模式的
webpack 运行；打包产物是用*本*镜像的前端源码生成的，所以基础镜像一动就必须重新生成；
而且一个 UI 被重建进去的模块，其后端仍然必须列在 `moduleImportSequence` 里，它的路由
才会存在。

**它解锁了什么。** 凡是 UI 属于注册表键或页面入口的功能，都可以靠「加上它的模块和它的
注册表键」变为可用——AI 助手、错误助手、管理面板、模板库、Git 集成。机制一旦验证通过，
其中的前三个就被移植了；§3.3 记录了各自的实际代价，包括移植前就看得见的两个障碍——它们
后来都被证明很小：

- AI 助手还额外需要 `modules/workbench`，它从 `@ai-sdk/openai-compatible` import
  `createOpenAICompatible`——这个包镜像只在 lockfile 里有，所以 PnP 会拒绝它，web 服务
  根本起不来。只需替换一处 import（改用已声明的 `@ai-sdk/openai` 里的 `createOpenAI`），
  之后该功能还需要 `AI_ENABLED`、`AI_BASE_URL`、`AI_API_KEY` 才能真正做事；
- 管理面板与基础镜像的 `user-activate` 注册的是同样两条路径，而先注册者胜，所以模块
  序列需要的是**插入**而不是追加——见 `overlay/etc/overleaf/overlay-modules.cjs` 里的
  `MODULE_PLACEMENT`。

### 3.3 这次解锁之后移植了什么

重建被证明可行之后，这些功能里有三个被移植了过来。每一个实际花了多大代价，是对着镜像
量出来的，而不是从源码树里读出来的：

| | AI 助手（`workbench` + `error-assistant`） | 管理面板（`admin-tools`） | 引用选择器（`reference-picker`） |
| --- | --- | --- | --- |
| 源文件 | 34 + 14 | 117 | 8 |
| 核心 `@/` import 数，以及其中缺失的个数 | 36 + 14，**0 个缺失** | 48，**0 个缺失** | 15，**0 个缺失** |
| 未声明的 npm 包 | `@ai-sdk/openai-compatible` | 无 | 无 |
| 它的 UI 如何到达浏览器 | 7 个注册表键 | 2 个 webpack **页面入口**（`globSync` 自己就会扫到） | 3 个注册表键 |
| 其他工作 | 一处 import 替换；`workbench` 要排在 `error-assistant` 之前 | 插在 `user-activate` **之前** | 无 |
| 需要外部服务 | 一个 AI 网关 | 无 | 无 |
| 需要重建 | 需要 | 需要 | 需要 |

有三件事值得记下来，因为它们并不显然：

- **`@/` import 才是真正的风险，而结果是没事。** 早先对 `admin-tools` 的分析只能说到
  「它有些 `@/...` import 可能是 Pro 专属的核心前端文件，在这里无法验证」；把 48 个
  全部对着镜像核一遍（`.research/` 风格的脚本，在容器里跑）一次就回答了。剩下的风险
  从来不是*核心*前端——两个产品里是同一份代码——而是 CE 镜像会移除的*模块*。
- **AI provider 的替换是真的，但很小。** `workbench` 从一个镜像只在 lockfile 里有的包里
  import `createOpenAICompatible`，所以 PnP 会拒绝它；又因为模块是用 `await import()`
  加载的，web 服务根本起不来。已声明的 `@ai-sdk/openai` 说的是同一套 wire protocol；
  差别在于裸的 provider 调用会落到哪个 API（`/responses` 而不是 `/chat/completions`），
  所以那一处调用点用的是 `.chat(...)`。移植代码写出来之前对着真实网关验证过一次，之后
  又顺着模块自身的代码路径验证了一次。
- **`reference-picker` 是整个仓库里最便宜的功能。** 基础镜像的核心已经带了 BibTeX
  解析器、编辑器的 BibTeX 语言、「root bib document」与「reference format」设置，以及
  一个*基础*的引用索引——而且它已经在为更好的索引调用
  `importOverleafModules('referenceIndices')`。该模块只提供另外三个注册表项，别的什么都
  不做；它的 `index.mjs` 是个空对象，所以它根本不在 `moduleImportSequence` 里。

---

## 4. 修订与审阅面板

这个功能看起来最像是需要重建 Overleaf 的那个，结果恰恰相反：**镜像里什么都有，只差一个布尔值。**

- `ProjectEditorHandler.mjs` 里有 `trackChangesAvailable: false`，并在项目载荷里以 `features.trackChangesVisible` 报出去。前端读的就是这个字段；前端里没有任何东西能把这个功能打开。
- `Features.hasFeature('track-changes')` 就是 `Settings.moduleImportSequence.includes('track-changes')`——它不依赖任何设置。
- 该功能需要的每个后端方法在 CE 核心里都已存在，而且核心在授权产品中就在调用它们：`DocumentUpdaterHandler.acceptChanges` / `getProjectRanges` / `resolveThread` / `reopenThread` / `deleteThread`、`DocstoreManager.getTrackedChangesUserIds`、`ChatApiHandler` 的线程方法、`AuthorizationMiddleware` 的守卫（`ensureUserCanWriteOrReviewProjectContent`、`ensureUserCanDeleteOrResolveThread`）、`EditorRealTimeController.emitToRoom`。`document-updater` 服务带有 `RangesManager.js` 与 `TrackedChangePreview.js`；`defaultFeatures.trackChanges` 为 `true`，所以用户默认就有权使用该功能。
- 审阅面板本身位于 CE 前端所依据的*同一份公开源码树*的 `services/web/frontend/js/features/review-panel` 中，并且由源码编辑器在 `features.trackChangesVisible` 之后渲染。`tests/verify-overlay.sh` 在镜像内证明了后端那一半；前端那一半只能靠实际使用来证明，这也是该功能默认关闭的原因。

该模块只有三个文件、10 KB；这次移植的主要工作其实是*判断它值得一试*，而上面的分析就是那个判断。

与它移植来源的分支有一处刻意的偏离：那个分支的 `acceptChanges` 只传了 `DocumentUpdaterHandler.acceptChanges(projectId, docId, changeIds, userId)` 四个参数中的三个，于是 `changesAccepted` 钩子被告知了错误的用户（`undefined`）。overlay 像相邻的处理器那样传入会话用户。

---

## 5. 沙箱编译与 TeX Live 工具链

### 5.1 编译服务

CE **已经为兄弟容器接好了线**，只是没有附带代码：挂载了 socket 时，它的 clsi 启动脚本会把 `www-data` 加入 `/var/run/docker.sock` 所属的组，而 `CommandRunner.js` 里有

```js
commandRunnerPath = Settings.clsi.dockerRunner === true
  ? './DockerRunner.js'
  : './LocalCommandRunner.js'
```

但 `services/clsi/config/settings.defaults.cjs` 会先检查这个文件是否存在，不存在就以*「Sandboxed compiles are only available with Overleaf Server Pro」*退出。两个文件（外加同一个设置文件会读取并要求的 seccomp 配置），功能就有了。

三个发现让这次移植不只是复制文件：

1. **runner 的命名在不同 release 之间并不一致。** 公开的 CE 源码树在两处都叫它 `DockerRunner.js`；那个分支把它改名为 `DockerRunner.mjs`，并同步改了两处。由于 overlay 必须能在一个*特定*的基础镜像上工作、又要经受得住重新适配，本仓库把真实文件作为 `DockerRunner.js` 提供，并额外提供一个只有一行 re-export 的 `DockerRunner.mjs`。`Dockerfile` 会打印基础镜像用的是哪个名字，因此变化会出现在构建日志里，而不是变成一次编译报错。
2. **web 侧需要三个 CE 里没人设置的设置。** `Settings.allowedImageNames`、`imageRoot` 与 `currentImageName` 被 `ClsiManager`、`ProjectOptionsHandler`、`ProjectCreationHandler` 与 `ProjectHelper` 读取，却从未被赋值，所以在 CE 里镜像选择器是死的，`bin/run-script scripts/set_tex_live_image.mjs` 会抛错。该模块负责推导它们，并且——与被移植的那一版不同——会校验它们彼此一致：`ProjectOptionsHandler.normalizeImageName()` 会把镜像重建成 `imageRoot + '/' + imageName`，而 clsi 会把 `TEX_LIVE_DOCKER_IMAGE` 原样交给 Docker，于是一份裸名列表加一个前缀，会为同一个项目产生两种不同的引用。这个矛盾现在会在启动时被拒绝，并在消息里给出修正办法。
3. **镜像 tag 不是装饰。** `DockerRunner` 从 tag 里读出 TeX Live 年份（`image.match(/:([0-9]+)\.[0-9]+/)`）来构造编译容器内的 `PATH`。`lvcs/sharelatex:6.3.0` 会被读成「TeX Live 6」。这就是本镜像不能作为自己编译镜像的原因，也是这个功能最容易被配错的地方。

部署那一半不是代码，也不可能变成代码：Docker socket、编译目录的宿主机路径与镜像列表都属于运维的职责，而 toolkit 只在 `SERVER_PRO=true` 时才做它那一半。这一点写在 `README.md` 里；真正的坑在于 *toolkit* 那一半（挂载 socket、`bin/up` 拉取镜像）由该标志门控，而 *clsi* 那一半由「文件是否存在」门控，所以只配了一半的部署，失败时会指向另一半。

### 5.2 编译工具链

与 `texlive-full` 做比较是值得的，原因很容易被忽略：两个镜像的差别主要不在*宏包*，而在**工具的配置**。

CE 镜像装好 TeX Live 后，把 latexmk 指向 `/usr/local/share/latexmk/LatexMk`，而它在 CE 里只有三行（`$go_mode = 3;`）。Overleaf 自己的编译镜像提供的是真正的文件，正是它让下面这些得以工作：

- `.Rtex`/`.Rnw` 文档（knitr 自定义依赖、`Rscript`、`knitr`/`stringr` 宏包、对 R 代码的 SyncTeX 补丁），
- glossaries 与 nomenclature（`makeglossaries`、`makeindex`），
- `feynmf`/`feynmp`、asymptote、metapost（它们各自的辅助程序），
- *Check* 按钮：clsi 会导出 `CHKTEX_OPTIONS` 等变量，而只有那个配置文件会消费它们，所以没有它，按钮会静默地什么都不做，
- `output.pdfxref`，PDF 预览会读它，而只有该文件里的 qpdf 步骤会写它。

提供这个文件意味着编译工具链必须完整，因此这次移植一并带来了 R（`r-base-core`、`r-cran-knitr`、`r-cran-stringr`）、ghostscript、qpdf、gnuplot、`python3-pygments`、GNU `time` 以及一个 UTF-8 locale。`tests/knitr` 会编译一份 `.Rnw` 文档，`tests/verify-overlay.sh` 会检查自定义依赖并运行 `run-chktex.sh`。

同一份比较还带来两个较小的条目：

- **字体缓存。** 如果构建期不做 `luaotfload-tool --update`，新容器里的第一次 LuaLaTeX 编译会重建整个字体数据库——慢到足以撞上编译超时，而且很容易被误认为文档本身慢。`fc-cache -fsv` 对 fontconfig 做的是同一件事。缓存必须写进 TeX Live 目录树，**而不是**写进 `TEXMFVAR`（`/var/lib/overleaf/tmp/texmf-var`）：`/var/lib/overleaf` 是卷，构建镜像时写在那里的东西在运行期是看不到的。
- **texmf.cnf 中的设置。** `openout_any`/`openin_any` 是 shell-escape 的另一半（minted、inkscape/svg、gnuplot 与 tikzexternalize 都会写到工作目录之外，而默认的 `p` 会拒绝），`OSFONTDIR` 则是与 fontconfig 并列的、kpathsea 层面的系统字体路径。`Dockerfile` 还会对 fontconfig 隐藏 Type1 字体，因为 XeTeX 无法内嵌它们，却会按字体族名匹配到它们。

刻意**没有**从 `texlive-full` 移植的：Google Fonts 下载与 Microsoft 核心字体安装器。本镜像改为内置字体，并把这一点讲清楚；加一个构建期从第三方镜像站下载的步骤，等于用可复现的构建去换一批许可证不明的字体。同一个想法里真正被采纳的，是字体覆盖本身，只是换了另一条路线——见下文。

### 5.3 Overleaf 文档里列出的字体

比较暴露出来的缺口是真实的：一份写着 `\setmainfont{Open Sans}` 或
`\setmainfont{Amiri}` 的文档会以 *「The font ... cannot be found」* 失败，尽管镜像
带着 TeX Live `scheme-full` 的全部内容——因为 Overleaf
[列出的那些可通过 `fontspec` 使用的字体族](https://www.overleaf.com/learn/latex/Questions/Which_OTF_or_TTF_fonts_are_supported_via_fontspec%3F)
只有一部分是 TeX Live 字体。那一页也说了其余部分该怎么办——*「use the relevant
Google Noto font, as included in Ubuntu 22.04」*——这正是本仓库采取的路线：
**用发行版的字体软件包**，而不是 `texlive-full` 在构建期下载的 `google/fonts` 仓库。

有三件事让这次移植比「加一串包名」更需要小心：

1. **在基础镜像可能基于的各个发行版上都可复现。** 每个包在加入之前都核对过：它在
   Ubuntu 24.04 与 22.04 **两者**里都存在（`.research/font-check/`），因为镜像构建在
   基础镜像所用的那个发行版上，而只在其中一个里存在的名字会在那边直接把构建搞失败。
2. **字体族名是从字体里读出来的，不是猜的。** 下载 `.deb` 并用 `fontTools` 读它们的
   name 表，纠正了三个否则会让 CI 失败的名字：`KacstOne` 在 `fonts-kacst-one` 里，
   而不在 `fonts-kacst`；泰文字体族是 `Tlwg Typo`，而不是 `TLWG Typo`；`fonts-khmeros`
   里没有裸的 `Khmer OS`。同一次核对还表明：URW base 35 那个包是拿到 `Nimbus
   Roman`、`C059` 或 `Z003` 的唯一途径——TeX Live 把它们作为 Type1 字体提供，而上面的
   fontconfig 规则会有意把它们隐藏掉。
3. **不能让默认渲染发生任何变化。** `fonts-ubuntu` 被刻意*不*安装——一份不指定字体的
   文档是否仍渲染成原样，不能取决于一次升级——而构建现在会打印 `serif`、`sans-serif`
   与 `monospace` 解析成什么，好让这种变化能被看见。`texlive-full` 那种
   `apt search ^fonts | xargs apt-get install` 的「一网打尽」正是因此被否决的，而不是
   因为体积。

`tests/fonts-extra` 会用 `fontspec` 在 XeLaTeX 下编译一份按组各选一个字体族的文档，
因此只要有字体族缺失或被改名，CI 就会失败，并把名字留在日志里。这正是它与最初那个
「加几个 Google 字体」的计划的区别：这份清单现在成了仓库可以据以回归测试的东西。

那份示例教给我们的三件事，现在都写在文件里了：

- **只要声明了字体族，就足以测试它。** `\newfontfamily{X}` 是在**声明时**就通过
  fontconfig 解析名字的，而不是第一次使用时——所以一个不存在的字体族会让构建失败，
  哪怕从没在它里面排过任何字。这一点两个方向都实测过，而它之所以重要，是因为那个
  显而易见的替代方案（每个字体族排一句示例文字）行不通：一个完全没有拉丁字符的字体
  会让 XeTeX 以 "there are no glyphs in the subset" 直接失败。
- **`\newfontfamily\testC059{C059}` 并不像看上去那样工作。** 在 TeX 里数字不是字母，
  所以那条语句声明的是 `\testC`，并把孤零零的 `0` 当作字体名交给 fontspec；报错是
  `The font "0" cannot be found`，对真正的错误只字不提。这些字体族里有两个叫 `C059`
  和 `Z003`，所以它们的命令名是完整拼出来的。
- **通用字体族钉不住，而这套集合确实会挪动它们。** 在镜像以前那套字体下，`serif` 与
  `sans-serif` 解析到 Noto 的 Regular 字面；换成完整集合后，它们解析到 SemiCondensed
  字面。`<alias><prefer>`、在前面插一个字体族的 `<match>`、以及指定一个普通 `width`
  ——各自都试过带与不带 `binding="strong"`——实测全都没有效果，因为每个 Noto Serif
  字面都声明同一个字体族名，而 fontconfig 在它们之间选择时会忽略请求的宽度。唯一
  有效的做法是把 condensed 字面直接拒绝掉，代价是它们变得无法选择。普通 LaTeX 文档
  两种情况下都不受影响：它的默认字体来自格式本身（Latin Modern），不是来自
  fontconfig，所以这只会体现在指名了*通用*字体族的文档以及非 TeX 工具里。
  `fonts-ubuntu` 依然不在包列表里，因为它可能直接拿下 `sans-serif` 这个别名。

### 5.4 这个镜像以前只在基础镜像构建当天才构建得出来

本轮第一次 CI 运行失败了，而失败与它在测的东西毫无关系：

```
#16 [stage-0 7/36] RUN tlmgr install latexmk texcount synctex etoolbox xetex
tlmgr itself needs to be updated.
...
tlmgr: Terminating; please see warning above!
```

只要 CTAN 仓库里的 `texlive.infra` 比已安装的新，`tlmgr` 就会拒绝*安装*任何东西。基础
镜像自带的是 7 月的 `tlmgr revision 79639`；到 10 月仓库已经是 `80502`，而 CTAN 每天
都会发布这个包的好几个修订版。所以**这个镜像根本没法从零构建**——那次 CI 之所以能走到
那一步，只是因为一直到 `tlmgr install scheme-full` 为止的各层都是几个月前那次构建留下
的缓存命中。冷构建会在 `scheme-full` 就失败，而只读 Dockerfile 的人没有任何办法知道
这一点。

修法*不是*什么：`update-tlmgr-latest.sh`，Dockerfile 里本来就在跑它。不带参数时它把
`texlive.infra` 留在原地；而带上 `-- --upgrade`——也就是 Overleaf 自己
`Dockerfile-base` 用的那种形式——它在这里会拒绝：*"have TL 2026, new version also
2026; using --upgrade doesn't make sense; terminating"*。修法是：`tlmgr update
--self`，也就是报错信息自己要求的那条命令，而且在无事可做时它是个空操作。动
Dockerfile 之前，两种做法都在容器里实测过。

因为仓库在一次构建*期间*也可能继续前进（光 scheme-full 就要好几分钟），Dockerfile 里
每一次 `tlmgr install` 之前都加了 `tlmgr update --self`，而不是只加在第一次。

由此得到的一般教训，也是这件事写进记录而不是提交信息的原因：**一个依赖会移动的第三方
的构建，它的第一步必须先把那个第三方更新到最新**，否则这个依赖会一直隐形，直到它崩掉
的那一天。

### 5.5 第一次真正跑测试发现了什么

本轮开始时，这个镜像从来没有在冷缓存下构建过，所以 `tests/verify-overlay.sh` 与
`tests/compile.sh` 都从未运行过——上一次绿色的 CI 已经是几个月前的事，而且早于这里
大部分测试。在本地把它构建出来并跑完两者，翻出了十个缺陷，而其中没有一个能靠阅读
发现。把它们列在这里，是因为模式本身就是重点：十个里有八个出在*测试*里，而那八个
要么是「因为错误的原因而通过」，要么会在一个正确的镜像上失败。

| 哪里错了 | 怎么暴露出来 | 为什么一直没被发现 |
| --- | --- | --- |
| `tlmgr install` 拒绝运行（见上文 §5.4） | 构建在第一次 `tlmgr install` 处停住 | 它上面的各层来自几个月前构建的缓存 |
| `tests/compile.sh` 用 `-r` 把共享 rc 交给 latexmk，于是示例自己的 rc 永远赢不了 | 每个要求 XeLaTeX 的示例都在用 LuaLaTeX 编译 | PDF 里没有任何东西会说明它是哪个引擎生成的 |
| knitr 示例被递了 `main.Rnw`，而 clsi 要的是 `main.tex` | latexmk 把引擎作用在 R 源码上 | 这个示例从未被编译过 |
| latexmk 需要 `-jobname=output`（clsi 也会传），否则它在一次无害的首轮之后以 12 退出 | `compile.sh` 在 knitr 示例上失败，尽管 PDF 是正确的 | 同上 |
| 内置的楷体字体叫 `Kaiti.ttf`，而不是 `KaiTi.ttf`，所以那个大小写敏感的复制从未生成 `simkai.ttf` | `tests/fonts-zhmetrics` 以 `cannot open TrueType font file` 失败 | 同上 |
| `verify-overlay.sh` 用 `require()` 读设置，然后断言的是*模块*在加载时才施加的设置 | 在一个正确的镜像上报 `imageRoot is undefined` | 它从未运行过 |
| 它还在功能关闭的状态下 import 了 clsi 的 `DockerRunner`，而那时 `clsi.docker` 并不存在 | `Cannot read properties of undefined (reading 'maxContainerAge')` | 同上 |
| 它拿 latexmk rc 去比对与文件里空格不同的字符串 | 在一个正确的文件上把 `add_cus_dep( 'glo'...` 报成「缺失」 | 同上 |
| `compile.sh` 在第二次运行时编译了 knitr 生成的 `main-concordance.tex` | 第一次运行留下了它，于是第二次失败 | 只有跑第二遍才会显形 |
| `compile.sh` 在第二次运行时编译了 shell-escape 示例生成的 `subdir/content.tex`，而且没有该示例自己的 latexmkrc | 第二次运行时 `Missing \begin{document}` | 同上——而这条排除规则最初就是为这一类文件写的，只是晚了一轮 |

有两个行为值得作为*产品本身的性质*记下来——它们也是以同样方式发现的，如今写在用户会去
查的地方：

- **`\tikzexternalize` 在 Overleaf 的编译调用方式下不可能工作。** pgfplots 通过再跑一次
  编译来外部化图形，而那次编译的包装是
  `\def\tikzexternalrealjob{\jobname}\input{\jobname}`；clsi 却用 `-jobname=output`
  调 latexmk，而源文件仍用自己的名字——于是包装去找 `output.tex`，那个文件不存在。图形
  失败（它自己的日志里是 `! Emergency stop`，`tikzext/plot.log`），而外层文档仍然产出
  PDF，这正是它难以察觉的原因。绕过办法是在 `external/system call` 里直接写出源文件名，
  而不是依赖 `\texsource`。原本为测这件事写的那个示例被缩减成它真正能证明的东西——
  shell-escape 往子目录里写文件——而不是去断言产品并不具备的行为。
- **`\write18` 在 LuaLaTeX 下是个空操作。** XeLaTeX 与 pdfLaTeX 会执行它，LuaLaTeX 不会
  （TeX Live 的 LuaTeX 期望通过 `\directlua` 调用 `os.execute`），这也是 `minted` 与
  `svg` 在 LuaLaTeX 下能用的原因——它们会探测引擎并切换做法。一份手写 `\write18` 的文档
  在三种引擎里的两种下能用，这一点在怪罪镜像之前值得知道：`texmf.cnf` 里是
  `shell_escape = t`，失败的是引擎本身。

---

## 6. 首个可用版本之后修掉的安全问题

第一版能登录了；让它**可以暴露到线上**的是下面三条。

### 6.1 未验证的邮箱就能识别账号（`d0febbe`）

**风险：** 仅凭邮箱匹配，意味着任何能在**某个**提供方注册同一地址的人都能顶替既有的 Overleaf 账号。
**修复：** 只有被**担保**的地址（`email_verified` 之类的提供方背书）才能识别账号；判断收敛在 `OidcEmailTrust.mjs`，并由 `tests/oidc-email-trust.test.mjs` 覆盖。

### 6.2 绑定时没有证明对账号的控制权（`0cac0a6`）

**风险：** 自动绑定会把"提供方侧被攻陷"直接变成"Overleaf 账号被接管"。
**修复：** OIDC 身份与既有账号匹配时，先要求输入该账号**密码**；确认页由 `login-oidc-link.pug` 渲染。

### 6.3 id_token 被"信任"而非"验证"（`0cac0a6`）

**风险：** 只读 userinfo 的实现在异构提供方下可被伪造与重放。
**修复：** `OidcIdToken.mjs` 校验签名（JWKS）、`iss`、`aud`、`exp`、`nonce`；由 `tests/oidc-id-token.test.mjs` 覆盖。

### 6.4 后续加固（`2bd219e`）

- 比较 `iss` 前归一化尾斜杠——不同提供方写法不一致，严格比较会在合法 IdP 上间歇失败。
- discovery 地址返回 HTML（被代理/网关拦成登录页）时，在配置阶段立刻报错；此前失败会推迟很久，只表现为无法解释的"登录失败"。

### 6.5 第二轮

- **修订功能默认关闭。** 这不是安全发现，而是一个决定：该功能会改变每个项目提供的内容，而只有运行中的实例才能展示整条链路（document-updater 的修订区间、chat 的线程、审阅面板）的行为。关着的功能不会把升级搞坏。
- **沙箱编译需要 Docker socket**，而它在宿主机上等价于 root。`README.md` 已经把这一点明说，建议是：为「每个项目一个 TeX Live 镜像」和「编译之间相互隔离」而启用它，不要把它当成防火墙的替代品。
- **`MAX_UPLOAD_SIZE` 会移动 zip 炸弹的限制。** 上传压缩包的解压后上限现在是上传上限的六倍，但不低于官方镜像允许的 300 MB——否则为一个大项目调高上传上限，它会因为一个与它无关的原因继续被拒。
- linked-URL 代理只在管理员要求 `url` 链接文件类型时才会配置，因此不会有实例仅仅因为升级就开始抓取 URL。

---

## 7. 验证手册

被测模块只 import Node 内置模块（或什么都不 import），所以不需要 Overleaf 也能跑：

```sh
node --test tests/oidc-callback-url.test.mjs tests/oidc-well-known.test.mjs \
            tests/oidc-id-token.test.mjs tests/oidc-link-request.test.mjs \
            tests/oidc-email-trust.test.mjs
# 共 65 例：callback-url 13、well-known 24、id-token 13、link-request 8、email-trust 7

node --test tests/overlay-settings.test.mjs            # 28 例
node --test tests/sandboxed-compiles-images.test.mjs   # 22 例

node --test /tests/oidc-*.test.mjs /tests/overlay-settings.test.mjs \
            /tests/sandboxed-compiles-images.test.mjs   # 在镜像内运行
tests/verify-overlay.sh                                # 其余检查，需要镜像
tests/compile.sh                                       # 最小可编译示例，需要镜像
```

只有实例能验证的：

- OIDC 登录流程本身、绑定确认页、账号匹配结果，以及提供方侧的回调地址白名单；
- 修订功能会把修改归属到作者、接受修改会移除标记、评论线程在刷新后依然存在；
- 沙箱编译确实发生在配置的镜像里（模块测试证明的是配置，不是容器）；
- 浏览器里的审阅面板、CI 中的 knitr 示例，以及每一个字体。
  本地全绿对这些一无所证。

`tests/verify-overlay.sh` 是长胖最多的部分：它在镜像内加载被替换的模块（这正是能抓到 Yarn PnP 解析问题的地方）、用桩驱动修订路由、在功能开关打开与关闭两种情况下检查设置文件、校验 seccomp 配置、检查 TeX Live 设置与 latexmk 自定义依赖、运行 `run-chktex.sh`，并编译视图。

### 7.1 这三个移植来的功能各自被什么检查住

AI 助手、管理面板与引用选择器都是在前端重建被证明可行（§3.2）之后移植的，每一个都在它
可能出错的地方被检查：

| 功能 | 能抓到回归的检查 |
| --- | --- |
| 三者都是 | `tests/verify-overlay.sh` 在镜像内 import 每个已移植模块的 `index.mjs`，并把它的 router 对着桩驱动一遍，这会解析整条 import 图——依赖缺失时正是它会让 web 服务起不来 |
| 三者都是 | 它还会在 `public/js` 里 grep 每个功能组件独有的字符串（`symbol-palette-close-button-outer`、`references-search-modal`、`workbench-ai-message`）。*核心*里也有的字符串会让这个检查失去意义，所以每一个都先对着镜像自己的 `frontend/` 核过——`ai-paywall-notification` 看起来很独特，其实活在三个核心文件里，这正是它没有被选中的原因 |
| 注册表 | `tests/frontend-rebuild.test.mjs` 会解析 `settings.frontend.cjs` 里的每个路径、检查核心所要的那些键，并检查标记字符串仍在组件里——这两半会朝相反的方向失败 |
| 模块顺序 | `tests/overlay-settings.test.mjs` 断言 `admin-tools` 被插在 `user-activate` **之前**（两者都注册 `/admin/user`，先注册者赢），以及 `workbench` 在 `error-assistant` 之前 |
| AI 网关 | 在移植代码写出来之前手工对着一个 DeepSeek 网关验证过一次：`createOpenAI({ baseURL, apiKey })` 配 `.chat(model)` 能应答并报出 token 用量，而这正是 `TokenQuota` 需要的。这一项不在 CI 里——它需要密钥 |

仍然只能手工验证、并且没有被验证的是：AI 面板在浏览器里能渲染并流式输出、管理面板的页面
能打开、以及引用选择器的模态框能弹出。这三者都需要一个跑起来的实例。

---

## 8. 这套方案自带的坑

1. **整文件替换。** `overlay/` 下每个文件都会静默覆盖上游在该文件里的改动，因此每次升级上游都要**逐文件对账**——包括被整文件替换的 `AuthenticationController.mjs`，而它恰好是上游最容易变动的文件。第二轮没有再增加整文件替换：新功能都放在新文件里，而设置文件是*读取*基础镜像的那一份，而不是替换它。
2. **不能引入新依赖**（Yarn PnP，见 §2）——这条先限制功能设计，才限制实现。
3. **前端是冻结的。** 任何需要模块贡献用户界面的东西都触达不到，无论它的后端解析得多好。§3 有完整清单。
4. **一个解析不了的 import 会杀掉整个 web 服务**，因为模块列表是在启动时顺序 import 的。
5. **`OVERLEAF_CONFIG` 现在也是契约的一部分。** 它指向本镜像的设置文件；覆盖它的部署会悄无声息地丢掉模块注册，唯一的症状就是某个功能不见了。
6. **提供方白名单不是代码。** 多主机部署需要在提供方登记所有回调地址（`OVERLEAF_OIDC_CALLBACK_URLS`），代码层面无法替代。
7. **沙箱编译的部署那一半也不是代码**，而 toolkit 把它的那一半门控在 `SERVER_PRO` 上。
8. **延迟暴露的错误最贵。** discovery 失败与 issuer 比较这两条，症状都离真正的配置错误很远；现在都在出错点立刻报。第二轮沿用了同一条规则：镜像配置不完整、缺少 `dvipdfmx-unsafe.cfg`、缺少 chktex 或 Rscript，现在都会让**构建**失败，并在消息里给出原因。

---

## 9. 未完成项

- 上游对账（§8.1）是人工步骤；每次升级把 overlay 与上游的 diff 一并提交会让它可复核。
- 多提供方特性（组映射、`preferred_username`）必须在依赖约束内设计。
- 端到端验证需要真实实例与真实提供方，不在 CI 范围内。修订功能与真正的沙箱编译同样如此。
- Google Fonts 现在已通过发行版的软件包覆盖（§5.3），不再依赖构建期下载；仍未覆盖的，是那些没有发行版打包的字体族（`Merriweather`、`Raleway`、`Oswald`、`Source Sans Pro`、`PT Sans` 等）。内置一个精选子集就能补上它，而且不需要构建期下载——这也是 `texlive-full` 的做法相对本仓库唯一还占优的地方。
- 前端重建已经存在并且可用（§3.2），目前承载一个模块：`symbol-palette`。它接下来让什么变得可触达、以及每一个还缺什么，都记在那一节里：AI 助手需要替换一行 import，外加一个 AI 网关；管理面板则与 `user-activate` 在 `/admin/user` 上相撞。加其中任何一个都是三处改动加一次重建。
- `MAX_UPLOAD_SIZE` 与 linked-URL 代理之所以只是设置，是因为它们被 CE 核心代码读取；它们所属的两个功能（大文件上传、linked URL）在镜像里其实都是完整的。
- 被否决的候选里唯一值得回过头做的是 `learn`（§3）：它的后端原样就能用，唯一的问题是它会在服务器开始监听**之前**缓存上游整个 wiki。改成后台抓取、或首次请求时抓取，就会比它来自的那个分支更好。
- 注册目前仍是全开或全关（`OVERLEAF_ENABLE_REGISTRATION`）。该分支在 `login-register` 模块里实现「限定单一邮箱域名」的做法，在本 overlay 里可以做成一个小模块：守住 `POST /register`，不通过就放行给核心处理器——只新增文件、不替换上游文件，而 `overlay-modules.cjs` 已经是打开它的地方。
