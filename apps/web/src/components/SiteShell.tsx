import { t, type Locale } from "@dayu/report-i18n";
import { useEffect, useState, type PropsWithChildren } from "react";
import { Link, useInRouterContext } from "react-router-dom";

import { isStaticPreview } from "../app/build-mode.js";
import { previewPath } from "../app/preview-navigation.js";
import { oppositeLocale } from "../i18n/locale.js";

export interface SiteShellProps extends PropsWithChildren {
  locale: Locale;
  repositoryPath?: string;
  navigationState?: unknown;
}

export function SiteShell({ children, locale, navigationState, repositoryPath = "" }: SiteShellProps): React.JSX.Element {
  const inRouter = useInRouterContext();
  const [evidenceHash, setEvidenceHash] = useState(() => isStaticPreview ? window.location.hash : "");
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  useEffect(() => {
    if (!isStaticPreview) return;
    const updateEvidenceHash = () => { setEvidenceHash(window.location.hash); };
    window.addEventListener("hashchange", updateEvidenceHash);
    return () => { window.removeEventListener("hashchange", updateEvidenceHash); };
  }, []);
  const alternate = oppositeLocale(locale);
  const alternatePath = isStaticPreview ? previewPath(alternate, repositoryPath === "/sample" ? "sample" : "home", evidenceHash) : repositoryPath === "" ? `/${alternate}` : `/${alternate}${repositoryPath}`;
  const homePath = isStaticPreview ? previewPath(locale, "home") : `/${locale}`;
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">{locale === "zh" ? "跳到主要内容" : "Skip to main content"}</a>
      <header className="site-header">
        <a aria-label={`${t(locale, "common.brand")} — ${t(locale, "common.subtitle")}`} className="brand" href={homePath}>
          <span aria-hidden="true" className="brand-seal"><span /></span>
          <span className="brand-name">{t(locale, "common.brand")}</span>
          <span className="brand-divider" />
          <span className="brand-subtitle">{t(locale, "common.subtitle")}</span>
        </a>
        <nav aria-label={locale === "zh" ? "主导航" : "Main navigation"} className="site-navigation">
          <a aria-current={repositoryPath === "/sample" ? "page" : undefined} className="sample-navigation" href={isStaticPreview ? previewPath(locale, "sample") : `/${locale}/sample`}>{locale === "zh" ? "样例报告" : "Sample report"}</a>
          {navigationState === undefined || !inRouter ? <a className="locale-switch" href={alternatePath} hrefLang={alternate}>
            <span aria-hidden="true">{locale.toUpperCase()}</span>
            <span className="locale-arrow" aria-hidden="true" />
            <span>{t(locale, "common.language")}</span>
          </a> : <Link className="locale-switch" hrefLang={alternate} state={navigationState} to={alternatePath}>
            <span aria-hidden="true">{locale.toUpperCase()}</span>
            <span className="locale-arrow" aria-hidden="true" />
            <span>{t(locale, "common.language")}</span>
          </Link>}
        </nav>
      </header>
      {children}
      <footer className="site-footer">
        <span>{t(locale, "common.publicOnly")}</span>
        <p>{t(locale, "report.disclaimer")}</p>
      </footer>
    </div>
  );
}
