import { t, type Locale } from "@dayu/report-i18n";

export function CopilotProgress({ locale }: { locale: Locale }): React.JSX.Element {
  return (
    <div aria-live="polite" className="copilot-progress" role="status">
      <span aria-hidden="true"><i /></span>
      <div><strong>{t(locale, "copilot.progress.title")}</strong><p>{t(locale, "copilot.progress.body")}</p></div>
    </div>
  );
}
