import type { Locale } from "@dayu/report-i18n";
import { useEffect } from "react";

import { previewPath } from "../app/preview-navigation.js";
import { SiteShell } from "../components/SiteShell.js";
import "../styles/preview-home.css";

const copy = {
  zh: {
    eyebrow: "在线体验 · Pre-beta",
    title: "给 GitHub 项目，测测含水量。",
    body: "看看公开仓库的代码、维护和热度是否对得上。DAYU 会列出值得核对的地方，并附上来源。",
    sample: "查看样例报告", local: "分析自己的仓库",
    boundary: "线上仅提供固定样例，不能扫描其他仓库。样例无需登录，也不会调用 Copilot。",
    caveat: "仅分析公开仓库。规则尚未校准，不能证明买星、刷量或造假。",
    map: "一份报告，先读什么？",
    steps: [["先读主要发现", "先了解观察到了什么，有什么仍不确定。"], ["需要时展开分析", "再看五个维度与完整发现。"], ["有疑问就核对来源", "点击依据，直接定位到原始证据。"]],
    guide: "想查自己的仓库？在本地开始。",
    guideBody: "线上暂未提供新扫描。你可以在自己的电脑启动 DAYU，然后输入公开仓库地址。基础分析无需 GitHub 登录或 Copilot。",
    requirements: "需要 Node.js 24+、pnpm 10 和 Git。",
    commands: "本地启动命令",
    open: "启动后，打开终端打印的中文或英文地址，在首页粘贴仓库链接，再点“开始分析”。端口可能变化，请以打印的地址为准。",
    finish: "保持终端运行；按 Ctrl-C 可停止本地服务。",
    docs: "查看完整运行说明",
  },
  en: {
    eyebrow: "Online preview · Pre-beta",
    title: "Look beyond the stars.",
    body: "DAYU compares a public GitHub repository’s code, maintenance, and popularity. See what needs a closer look, with sources you can check.",
    sample: "View sample report", local: "Check your own repository",
    boundary: "This website offers a saved sample only. It cannot scan other repositories, sign you in, or call Copilot.",
    caveat: "Public repositories only. The rules are uncalibrated and cannot prove bought stars, manipulated engagement, or fraud.",
    map: "How to read a report",
    steps: [["Start with the observations", "See what was found and what is still uncertain."], ["Open the analysis if needed", "Explore five dimensions and the full findings."], ["Check a source", "Follow a finding straight to its underlying evidence."]],
    guide: "Check your own repository locally.",
    guideBody: "New scans are not hosted on this website. Run DAYU on your computer and enter a public repository URL. Basic analysis needs neither GitHub sign-in nor Copilot.",
    requirements: "You need Node.js 24+, pnpm 10, and Git.",
    commands: "Local setup commands",
    open: "Open the local URL printed in your terminal. Paste a repository URL into the home page and choose Analyze repository. The port can vary, so use the printed address.",
    finish: "Keep the terminal running. Press Ctrl-C to stop the local service.",
    docs: "Read the full setup guide",
  },
} as const;

const commands = "git clone https://github.com/Thworry/dayu.git\ncd dayu\ncorepack enable\npnpm install --frozen-lockfile\npnpm demo";

export function PreviewHomePage({ locale }: { locale: Locale }): React.JSX.Element {
  const text = copy[locale];
  useEffect(() => {
    if (window.location.hash !== "#local-guide") return;
    const guide = document.getElementById("local-guide");
    guide?.focus({ preventScroll: true });
    guide?.scrollIntoView({ block: "start" });
  }, []);
  return <SiteShell locale={locale}>
    <main className="preview-home" id="main-content" tabIndex={-1}>
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="eyebrow">{text.eyebrow}</p>
          <h1 id="welcome-title">{text.title}</h1>
          <p className="welcome-body">{text.body}</p>
          <div className="welcome-actions">
            <a className="welcome-primary" href={previewPath(locale, "sample")}>{text.sample}<span aria-hidden="true">→</span></a>
            <a href="#local-guide">{text.local}<span aria-hidden="true">↓</span></a>
          </div>
          <p className="welcome-boundary">{text.boundary}</p>
          <p className="welcome-caveat">{text.caveat}</p>
        </div>
        <aside className="welcome-route-map" aria-labelledby="welcome-map-title">
          <h2 id="welcome-map-title">{text.map}</h2>
          <ol>{text.steps.map(([title, body], index) => <li key={title}><span aria-hidden="true">0{index + 1}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
        </aside>
      </section>
      <section className="welcome-local-guide" id="local-guide" tabIndex={-1} aria-labelledby="local-guide-title">
        <div><h2 id="local-guide-title">{text.guide}</h2><p>{text.guideBody}</p><p className="welcome-requirements">{text.requirements}</p></div>
        <div><pre aria-label={text.commands} tabIndex={0}><code>{commands}</code></pre><p>{text.open}</p><p>{text.finish}</p><a href={`https://github.com/Thworry/dayu${locale === "zh" ? "/blob/main/README.zh-CN.md#本地开始" : "#quick-start"}`}>{text.docs}<span aria-hidden="true"> ↗</span></a></div>
      </section>
    </main>
  </SiteShell>;
}
