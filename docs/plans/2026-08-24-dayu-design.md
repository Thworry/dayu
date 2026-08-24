# 大禹治水（DAYU）设计规格

- 英文副标题：Repo Reality Check
- 文档状态：已确认，待用户审阅
- 规格版本：0.1.0
- 日期：2026-08-24
- 首版许可证：Apache-2.0

## 1. 产品概述

大禹治水是一面带娱乐表达的“GitHub 照妖镜”。用户输入公开 GitHub
仓库地址后，产品基于可复核的公开证据，评估仓库热度与实际内容、维护和社区表现是否协调，
并生成中英双语报告及可分享卡片。

产品可以指出“含水风险”“宣传与实现不协调”等现象，但不判定作者买星、造假或欺诈。
GitHub 公共数据通常不足以证明这些行为，因此所有表达都必须保持为风险提示和证据解读。

核心原则：

1. 先证据、后结论：每个结论都能回到一个或多个 Evidence ID。
2. 基础结果可复现：同一仓库、提交和规则版本应产生相同的基础分。
3. AI 是增强项：没有 GitHub Copilot 或额度时，基础报告仍完整可用。
4. 缺失不是异常：取不到的数据降低置信度，不直接提高风险分。
5. 幽默只用于包装：证据页、评分说明和申诉入口保持严肃、克制。

## 2. 用户与核心场景

主要用户：

- 想快速判断开源项目是否值得投入时间的开发者。
- 想核对宣传与实际实现是否一致的技术选型者。
- 想以轻松方式分享仓库观察结果的开源社区用户。
- 希望发现 README、维护或社区协作问题的仓库维护者。

首版核心流程：

1. 用户粘贴 owner/repo 或完整 GitHub URL。
2. 系统校验仓库是公开且可访问的。
3. 系统抓取公开元数据、仓库结构、文档、发布、提交、Issue 和 PR 等证据。
4. 规则引擎识别仓库类型，生成基础评分、置信度和证据清单。
5. 用户可选择“让我的 Copilot 深度照妖”，通过 GitHub OAuth 授权。
6. 服务端使用用户自己的 Copilot 权益做受约束的语义评估。
7. 系统生成中英双语报告和分享卡片。
8. 用户可以下载图片或复制一个会重新扫描当前数据的仓库链接；维护者可以通过“报告可能有误”入口反馈。

## 3. MVP 范围

### 3.1 必须提供

- Web 主入口，支持桌面和移动浏览器。
- 仅分析公开 GitHub 仓库。
- 不登录即可执行基础扫描。
- 仓库类型识别和类型校正。
- 五维基础评分、综合含水风险和置信度。
- 完整证据清单、数据时间和规则版本。
- 可选的用户 GitHub OAuth 与用户 Copilot 深度分析。
- 中文和英文报告。
- 分享卡片，但卡片必须保留“风险评估”与置信度提示。
- complete、partial、unverifiable 三种数据状态。
- GitHub API 限流、Copilot 不可用和部分数据缺失时的降级。
- 报告纠错或反馈入口。

### 3.2 首版不做

- 私有仓库分析。
- “最水仓库”或类似公开排行榜。
- 永久公开、可被搜索引擎索引的 AI 报告。
- 对维护者粉丝或关注者生成“造假分”。
- 宣称检测或证明买星、刷量、欺诈。
- 执行仓库代码、构建脚本或安装依赖。
- Chrome 扩展、CLI、MCP 服务；这些作为后续入口。

## 4. 体验与文案

核心双语标签：

| 中文 | English |
| --- | --- |
| GitHub 照妖镜 | Repo Reality Check |
| 含水风险 | Hype Score |
| 分析置信度 | Confidence |
| 热度协调性 | Popularity Signals |
| 内容含金量 | Code Substance |
| 维护真实性 | Maintenance Health |
| 社区质量 | Community Activity |
| 宣传兑现度 | Claims vs. Code |

风险分段：

| 分数 | 中文 | English |
| --- | --- | --- |
| 0-19 | 实打实 | Solid Ground |
| 20-39 | 有点包装，很正常 | A Little Glossy |
| 40-59 | 水汽上来了 | Hype Is Showing |
| 60-79 | 海绵体质 | Heavy on Hype |
| 80-100 | 洪水预警 | Flood Warning |

每份报告从上到下依次展示：

1. 综合含水风险、置信度、数据状态和仓库类型。
2. 一句话摘要，避免绝对指控。
3. 五维评分及各自贡献。
4. 主要发现，每条附 Evidence ID。
5. 证据详情、抓取时间、数据缺口和规则版本。
6. 可选 Copilot 语义分析结果及其单独标识。
7. 方法说明、反馈入口和免责声明。

## 5. 技术架构

采用 TypeScript monorepo，首版部署为一个长期运行的 Node.js 服务：

- apps/web：React Web 应用，负责输入、状态、报告与分享卡片。
- apps/api：Fastify API，负责任务编排、会话、限流和报告接口。
- packages/github-collector：GitHub 公共数据抓取、规范化和缓存。
- packages/scoring-core：确定性规则、仓库分类、评分和置信度。
- packages/copilot-adapter：OAuth 后的 Copilot 会话和固定模式输出。
- packages/report-i18n：中英双语文案、报告模型和渲染数据。
- packages/evidence-schema：Evidence、Finding 和 Report 的共享类型与校验。

请求链路：

Web -> Fastify API -> GitHub Collector -> Short-lived Evidence Cache
                       -> Scoring Core -> Base Report
                       -> Optional Copilot Adapter -> Enriched Report
                       -> Report i18n -> Web / Share Card

架构约束：

- 前端永远不接触 GitHub OAuth token。
- 评分核心不依赖 UI，也不依赖 Copilot，便于测试和复用。
- 收集、评分、语义判断、翻译和渲染分别版本化。
- 长任务使用可查询的 job 状态，避免靠一条长连接维持完整分析。
- 每个阶段先持久化中间结果，再发送进度事件；断线后可从最近阶段恢复。

## 6. GitHub 数据边界

首版只使用公开且允许访问的数据，包括：

- 仓库基本信息、创建和更新时间、默认分支、主题和许可证。
- Stars、Forks、Open Issues、真实 Watch/Subscribers。
- 文件树、语言统计、关键目录、README、许可证和贡献指南。
- 提交、贡献者、发布、标签、Issue 和 PR 的有限窗口样本。
- 可获得时的讨论、CI 配置、安全策略和依赖声明。

必须正确处理 GitHub 字段语义：

- watchers_count 在常用 Repository API 响应中实际等同于 Stars。
- 真实 Watch 数使用 subscribers_count。
- 不得把 watchers_count 和 stargazers_count 当成两个独立热度信号。

公共 API 对完整 Stargazer 账号、时间序列和历史可见性存在限制。系统可以识别热度与内容、
维护或社区表现的不协调，但不能据此证明买星。报告只使用“风险较高”“信号不协调”
“公开数据不足以验证”等措辞。

收集结果包含：

- dataStatus：complete、partial 或 unverifiable。
- collectedAt：UTC 时间。
- sourceCommit：分析时默认分支提交 SHA。
- missingSignals：未取得的信号及原因。
- collectorVersion：收集器和 GitHub API 版本。

## 7. 仓库类型识别

评分前先识别主要仓库类型，至少覆盖：

- application：完整应用或服务。
- library：库、SDK 或框架。
- documentation：文档和教程。
- data：数据集或模型资产。
- art：设计、字体、图片或创意资源。
- template：脚手架和模板。
- awesome-list：精选链接集合。
- archived：明确归档或停止维护。

类型识别使用文件结构、语言占比、README 描述、Topic 和归档状态。低置信类型允许多标签，
并在报告中说明采用的校正规则。

类型校正示例：

- 文档、数据、艺术和 awesome-list 不因代码行数少而被直接惩罚。
- 库项目更重视 API、测试、发布与版本记录。
- 应用项目更重视可运行入口、安装步骤、测试和持续集成。
- 模板项目更重视可复用结构、示例和更新情况。
- 已归档项目不因近期无提交自动得到高风险，但必须显著提示归档状态。

## 8. 评分模型

### 8.1 五个维度

综合含水风险为 0-100，五维权重为：

| 维度 | 权重 | 主要观察 |
| --- | ---: | --- |
| 热度协调性 | 25% | Stars、Forks、Watch、Issue/PR、贡献者和时间变化之间是否协调 |
| 内容含金量 | 25% | 与仓库类型匹配的实现、测试、示例、发布资产和原创内容 |
| 维护真实性 | 20% | 提交连续性、版本发布、Issue 处理、CI 和维护文档 |
| 社区质量 | 15% | 有实质内容的 Issue/PR、贡献者分布、讨论和协作信号 |
| 宣传兑现度 | 15% | README 声明、功能、安装和演示与仓库实际内容是否一致 |

基础公式：

Base Hype Score =
Popularity × 0.25 +
Substance × 0.25 +
Maintenance × 0.20 +
Community × 0.15 +
Claims × 0.15

各维度均为“风险越高、分数越高”。显示时同时提供事实型正向信号，避免把报告变成单向挑错。

### 8.2 规则与 Copilot 的组合

- 70%：可复现的确定性规则。
- 30%：可选的用户 Copilot 语义评估。

未启用或无法使用 Copilot 时，不把缺失的 30%记为高风险。此时综合结果就是规则报告，
并明确标记 Base Analysis。启用 Copilot 后，语义部分只评估适合语义判断的内容，
例如 README 声明与文件证据是否一致；不得改写原始事实。

每条规则都要声明：

- ruleId 和 ruleVersion。
- 适用的仓库类型。
- 输入 Evidence ID。
- 分值影响和上限。
- 数据不足时的行为。
- 可读解释和反例。

单一异常不得直接把综合风险推入高风险区。高风险需要多个相互独立的信号共同支持。

### 8.3 置信度

置信度是 0-100 的分析覆盖度和可靠性指标，不是“结论正确概率”。主要由以下因素决定：

- 必需数据覆盖率。
- 仓库类型识别确定性。
- 样本窗口是否足够。
- API 是否限流或返回不完整。
- 规则之间是否相互矛盾。
- Copilot 结果是否通过结构和证据校验。

缺失数据只降低置信度。若关键数据不足，系统应：

- 将 dataStatus 设为 partial 或 unverifiable。
- 不显示伪精确的综合数字，改为范围或“证据不足”。
- 保留已获得的事实和 Evidence ID。
- 明确列出缺少什么，以及用户何时可重试。

## 9. 证据与报告模式

Evidence 最少包含：

- id：稳定的 Evidence ID。
- kind：metadata、file、commit、release、issue、pull_request 等。
- source：GitHub API 或文件路径。
- observedAt：观察时间。
- summary：中性事实描述。
- value：结构化原始值或安全摘录。
- limitations：采样和缺失说明。

Finding 最少包含：

- id、dimension、severity。
- titleKey 和 explanationKey。
- evidenceIds：一个或多个已经存在的 Evidence ID。
- ruleId 或 copilotJudgmentId。
- scoreImpact。
- caveat。

Report 最少包含：

- repository、sourceCommit、repositoryType。
- dataStatus、missingSignals。
- baseScore、enrichedScore（可选）、confidence。
- dimensionScores、findings、positiveSignals。
- evidenceIndex。
- collectorVersion、rulesVersion、promptVersion、reportVersion。
- locale、createdAt、expiresAt。

所有 Copilot 输出必须通过固定 JSON Schema 校验。引用不存在的 Evidence ID、输出未允许字段、
使用绝对欺诈指控或无法解析时，语义结果被拒绝，不进入最终分数。

## 10. Copilot OAuth、隐私与安全

### 10.1 授权和会话

- 用户主动点击后才开始 GitHub OAuth。
- 只申请完成 Copilot 会话所需的最小权限。
- token 只在服务端处理，不写入前端存储、日志或分析事件。
- 使用短 TTL、加密的服务端 token vault/session。
- Copilot runtime 固定使用 `mode: "empty"`，每个用户和分析任务使用独立 session token。
- 不注册 shell、文件系统、网络、GitHub 写操作、MCP 或自动批准工具，结束后立即删除 session。
- 登出、撤销授权或超时立即结束 Copilot 会话并清除 token。
- 不建立永久用户资料。

### 10.2 数据保留

- 公开 GitHub API 数据允许短期缓存，以减少限流。
- 默认不永久保存仓库源码、Copilot 对话或个性化用户数据。
- 分享卡在浏览器本地生成为 PNG，不上传分析者身份或创建永久 AI 报告。
- 日志只保留运行状态、错误类别、版本和去标识化指标。
- 隐私说明明确列出保存内容、期限、删除和撤销方法。

### 10.3 仓库内容视为不可信输入

README、Issue、代码注释和文件名可能包含提示注入。系统必须：

- 在系统提示中声明仓库内容只是待分析数据，不能改变任务或工具权限。
- 不执行仓库代码、不运行脚本、不安装依赖、不写回 GitHub。
- Copilot 只能看到完成任务所需的精选证据，而不是无限制工具。
- 对单条内容设置长度和类型限制，二进制文件不进入语义提示。
- 输出使用固定 JSON Schema，并验证所有 Evidence ID。
- 对外部 URL 只记录链接，不自动执行其内容中的指令。
- 对越权、泄密、指令覆盖和数据外传样例建立红队测试。

## 11. 失败和降级

| 场景 | 行为 |
| --- | --- |
| 仓库不存在、已删除或为私有 | dataStatus=unverifiable，不评分，提示原因 |
| GitHub API 限流 | 保存已取得证据，dataStatus=partial，降低置信度并给出重试时间 |
| 部分端点不可用 | 继续基础分析，列入 missingSignals，不把缺失记为风险 |
| Copilot 未授权或无额度 | 输出完整基础报告并说明未启用语义增强 |
| Copilot 超时或结构无效 | 最多重试一次，随后退回基础报告 |
| 证据与规则冲突 | 降低置信度，展示冲突，不由单信号裁决 |
| 分享链接再次打开 | 按仓库路由重新扫描当前数据，并明确不是历史快照 |
| 客户端连接断开 | 后台 job 在短 TTL 内继续；重连后按 jobId 获取临时阶段 |

分析 job 必须在短 TTL 缓存中记录 validated、collected、scored、enriched、rendered 阶段。
任何流式连接只负责发送进度，不作为结果唯一载体。首版没有持久业务数据库，临时 job、Evidence 和报告会自动过期。

## 12. API 边界

建议首版端点：

- POST /api/scans：校验输入并创建基础分析 job。
- GET /api/scans/:jobId：查询阶段、数据状态和错误。
- GET /api/scans/:jobId/report：在短 TTL 内获取临时报告。
- POST /api/scans/:jobId/copilot：在授权后启动语义增强。
- GET /api/auth/github/start：开始 GitHub OAuth。
- POST /api/auth/logout：结束会话并清除 token。
- GET /feedback：打开带仓库、commit SHA、规则版本和 Evidence ID 的预填反馈入口。

所有写接口需要 CSRF 防护、速率限制和结构校验。错误响应使用稳定错误码，不把 token、
提示原文或内部堆栈返回给客户端。

## 13. 测试与校准

### 13.1 自动化测试

- scoring-core 单元测试：每条规则的正例、反例、数据缺失和类型校正。
- collector 合约测试：GitHub 字段映射，特别是 Stars 与 Subscribers。
- 固定仓库快照测试：同一提交和规则版本产生相同基础分。
- Schema 测试：拒绝不存在的 Evidence ID 和额外 Copilot 字段。
- 安全测试：提示注入、恶意 README、超长内容、外部链接和敏感日志。
- OAuth 测试：最小权限、过期、撤销、登出和 token 不出现在客户端。
- 降级测试：限流、端点超时、Copilot 无额度、重试失败。
- i18n 测试：所有报告 key 有中英文本，数字和标签一致。
- Web 可访问性与移动端布局测试。

### 13.2 评分校准

维护一个可公开审计的基准集和挑战集，覆盖不同类型、年龄、规模和热度的仓库。
规则、数据快照和人工评审 rubric 全部版本化。每次规则变更输出：

- 各类型的分数分布变化。
- 已知误报和漏报。
- 关键样例前后对比。
- 迁移说明和规则版本。

“Hype Score”在 beta 阶段必须标记为启发式风险分，而非统计概率。

## 14. MVP 验收标准

满足以下条件才可发布：

1. 任意合法公开 GitHub URL 或 owner/repo 可以创建分析。
2. 不登录、不使用 Copilot 时可以得到可解释的基础报告。
3. 报告的每个结论至少引用一个可打开的 Evidence ID。
4. 同一仓库提交和规则版本重复分析，基础分一致。
5. 文档、数据、艺术、模板、awesome-list 和归档仓库不会被代码量规则误伤。
6. watchers_count 不被当作真实 Watch，真实 Watch 使用 subscribers_count。
7. 限流和数据缺失只降低置信度，不直接提高风险。
8. 关键证据不足时不展示伪精确综合分。
9. Copilot 失败后仍能查看基础报告，且最多重试一次。
10. 前端、日志和报告中不出现 OAuth token。
11. 恶意仓库内容不能改变系统指令、触发代码执行或引用虚假证据。
12. 中英文报告信息等价，分享卡片带有风险和置信度语境。
13. 报告提供方法说明、数据时间、版本、局限性和纠错入口。

## 15. 分阶段实施计划

### 阶段 A：工程骨架与共享模式

- 建立 TypeScript monorepo、React、Fastify 和测试基础。
- 定义 Repository、Evidence、Finding、Score 和 Report Schema。
- 建立版本字段、错误码和 job 阶段模型。

### 阶段 B：GitHub 收集与仓库分类

- 完成 URL 规范化、公共仓库校验、API 客户端和短期缓存。
- 实现 watchers_count/subscribers_count 正确映射。
- 产出带缺失原因的 Evidence 集和仓库类型判断。

### 阶段 C：可复现评分核心

- 实现五维规则、权重、单规则上限和类型校正。
- 实现置信度、partial/unverifiable 和伪精确保护。
- 建立固定快照、基准集和规则版本回归测试。

### 阶段 D：基础 Web 报告

- 实现输入、job 进度、双语报告、证据详情和失败降级。
- 实现浏览器端分享卡片、重新扫描链接和纠错入口。
- 完成移动端、可访问性和免责声明。

### 阶段 E：用户 Copilot 增强

- 完成最小权限 OAuth、短 TTL 加密 token vault 和登出清理。
- 实现受约束证据包、固定 JSON Schema 和 Evidence ID 校验。
- 完成注入防护、一次重试和基础报告回退。

### 阶段 F：发布准备

- 完成隐私说明、安全评审、限流、监控和故障演练。
- 发布评分方法、版本历史、基准集说明和 Apache-2.0 LICENSE。
- 标记 beta 并收集误报、纠错和类型校正反馈。

## 16. 后续方向

MVP 稳定后，可以在共享 scoring-core 和报告 API 上增加：

- Chrome 扩展：GitHub 仓库页的一键分析入口。
- CLI：本地或 CI 中生成可复现基础报告。
- MCP 服务：供开发工具查询报告和证据。
- 维护者自查模式：给出改善文档、测试和协作信号的建议。

这些入口不得改变证据、隐私和非指控边界。

## 17. 发布与治理

- 代码采用 Apache-2.0。
- 规则、权重、类型校正和方法说明公开版本化。
- 安全问题使用 SECURITY.md 中的私密渠道报告。
- 评分争议使用结构化反馈，保留规则版本、提交 SHA 和 Evidence ID。
- 重大评分变更必须更新 changelog 和基准集结果。
- 不允许将报告用作自动封禁、骚扰维护者或事实性欺诈判定。

本规格通过用户审阅后才进入实现阶段。
