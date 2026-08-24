import { t, type Locale } from "@dayu/report-i18n";

export function Disclaimer({ locale }: { locale: Locale }): React.JSX.Element {
  return (
    <aside className="report-disclaimer">
      <span aria-hidden="true">i</span>
      <p>{t(locale, "report.disclaimer")}</p>
    </aside>
  );
}
