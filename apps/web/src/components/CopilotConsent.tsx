import { t, type Locale } from "@dayu/report-i18n";
import { useState } from "react";

export interface CopilotConsentProps {
  authState?: "authenticated" | "signed_out" | "unavailable";
  busy?: boolean;
  locale: Locale;
  onConnect?: () => void;
  onConfirm: () => void;
}

export function CopilotConsent({ authState = "authenticated", busy = false, locale, onConnect, onConfirm }: CopilotConsentProps): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  if (authState === "unavailable") {
    return (
      <section aria-labelledby="copilot-unavailable-title" className="copilot-consent copilot-unavailable">
        <div className="copilot-channel" aria-hidden="true"><span /></div>
        <div>
          <p className="copilot-kicker">{t(locale, "copilot.kicker")}</p>
          <h2 id="copilot-unavailable-title">{t(locale, "copilot.unavailable.title")}</h2>
          <p>{t(locale, "copilot.unavailable.body")}</p>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="copilot-consent-title" className="copilot-consent">
      <div className="copilot-channel" aria-hidden="true"><span /></div>
      <div>
        <p className="copilot-kicker">{t(locale, "copilot.kicker")}</p>
        <h2 id="copilot-consent-title">{t(locale, "copilot.consent.title")}</h2>
        <p>{t(locale, "copilot.consent.body")}</p>
        <ul>
          <li>{t(locale, "copilot.consent.evidence")}</li>
          <li>{t(locale, "copilot.consent.quota")}</li>
          <li>{t(locale, "copilot.consent.provider")}</li>
        </ul>
        {authState === "authenticated" ? (
          <>
            <label className="copilot-confirmation">
              <input checked={confirmed} onChange={(event) => { setConfirmed(event.currentTarget.checked); }} type="checkbox" />
              <span>{t(locale, "copilot.consent.confirm")}</span>
            </label>
            <button disabled={!confirmed || busy} onClick={onConfirm} type="button">
              {t(locale, busy ? "copilot.action.running" : "copilot.action.enhance")}
            </button>
          </>
        ) : (
          <button onClick={onConnect} type="button">{t(locale, "copilot.action.connect")}</button>
        )}
      </div>
    </section>
  );
}
