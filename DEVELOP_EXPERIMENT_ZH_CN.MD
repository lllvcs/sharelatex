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
  | LDAP、该分支自带的 OIDC 模块 | 还额外被挡住：`ldapjs` 与 `passport-openidconnect` 并未被 `@overleaf/web` 声明，PnP 会拒绝该 import，整个 web 服务都起不来 |
  | `authentication/saml` | 可以解析——`@node-saml/passport-saml` 已被声明且有 patch——但它自带一套登录/登出路由，会与 OIDC overlay 的冲突；而且该分支依赖的 `@node-saml/node-saml` patch 在本镜像里*没有*应用，所以上线前无法验证其行为 |
  | `login-register` 的 `@domain` 注册限制 | 该模块整体替换了登录与注册页面，而本分支已经为 OIDC 替换过它们；其中只有「注册仅限某个邮箱域名」这一项检查能带来增量，而它应当放进核心注册控制器，而不是再造第二套 |

  AI 这一例值得完整记下来，因为它正是最多人问的那个：镜像*确实*声明了 `ai@6`、`@ai-sdk/openai`、`@ai-sdk/google-vertex`、`@ai-sdk/mcp` 与 `zod`，所以在替换掉一个 import（`@ai-sdk/openai-compatible` 里的 `createOpenAICompatible`，而它只是一个传递依赖）之后，后端是能跑起来的。但它依然触达不到，因为聊天面板、错误助手组件以及触发它们的编辑器扩展都被编译进了打包产物。如果本仓库哪天加上了前端构建步骤，那就是转折点。
- **模块列表里的顺序很关键。** 该序列是用 `await import()` 逐个走的，因此只要有一个模块的 import 解析不了，`loadModules()` 就会中断，web 服务根本起不来。只能加入已知能解析的模块。

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

刻意**没有**从 `texlive-full` 移植的：Google Fonts 下载与 Microsoft 核心字体安装器。本镜像改为内置字体，并把这一点讲清楚；加一个构建期从第三方镜像站下载的步骤，等于用可复现的构建去换一批许可证不明的字体。这个缺口是真实存在的（*Open Sans*、*Roboto* 之类的字体族确实没有），已记录在未完成项里。

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
- Google Fonts 是字体集合里唯一明显的缺口；内置一个精选子集就能补上它，而且不需要构建期下载。
- 如果哪天真的加了前端构建步骤，AI 助手只要替换一处 import 就能触达（§3）；在那之前不行。
- `MAX_UPLOAD_SIZE` 与 linked-URL 代理之所以只是设置，是因为它们被 CE 核心代码读取；它们所属的两个功能（大文件上传、linked URL）在镜像里其实都是完整的。
- 被否决的候选里唯一值得回过头做的是 `learn`（§3）：它的后端原样就能用，唯一的问题是它会在服务器开始监听**之前**缓存上游整个 wiki。改成后台抓取、或首次请求时抓取，就会比它来自的那个分支更好。
- 注册目前仍是全开或全关（`OVERLEAF_ENABLE_REGISTRATION`）。该分支在 `login-register` 模块里实现「限定单一邮箱域名」的做法，在本 overlay 里可以做成一个小模块：守住 `POST /register`，不通过就放行给核心处理器——只新增文件、不替换上游文件，而 `overlay-modules.cjs` 已经是打开它的地方。
