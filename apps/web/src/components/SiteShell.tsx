import { t, type Locale } from "@dayu/report-i18n";
import { useEffect, type PropsWithChildren } from "react";
import { Link, useInRouterContext } from "react-router-dom";

import { oppositeLocale } from "../i18n/locale.js";

export interface SiteShellProps extends PropsWithChildren {
  locale: Locale;
  repositoryPath?: string;
  navigationState?: unknown;
}

export function SiteShell({ children, locale, navigationState, repositoryPath = "" }: SiteShellProps): React.JSX.Element {
  const inRouter = useInRouterContext();
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  const alternate = oppositeLocale(locale);
  const alternatePath = repositoryPath === "" ? `/${alternate}` : `/${alternate}${repositoryPath}`;
  return (
    <div className="site-shell">
      <header className="site-header">
        <a aria-label={`${t(locale, "common.brand")} — ${t(locale, "common.subtitle")}`} className="brand" href={`/${locale}`}>
          <span aria-hidden="true" className="brand-seal"><span /></span>
          <span className="brand-name">{t(locale, "common.brand")}</span>
          <span className="brand-divider" />
          <span className="brand-subtitle">{t(locale, "common.subtitle")}</span>
        </a>
        <nav aria-label={t(locale, "common.language")}>
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
