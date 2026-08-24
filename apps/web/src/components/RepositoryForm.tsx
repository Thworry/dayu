import { t, type Locale } from "@dayu/report-i18n";
import type { SyntheticEvent } from "react";

export interface RepositoryFormProps {
  errorId?: string;
  locale: Locale;
  onRepositoryChange: (value: string) => void;
  onSubmit: () => void;
  repository: string;
  submitting: boolean;
}

export function RepositoryForm({
  errorId,
  locale,
  onRepositoryChange,
  onSubmit,
  repository,
  submitting,
}: RepositoryFormProps): React.JSX.Element {
  const hintId = "repository-hint";
  const describedBy = errorId === undefined ? hintId : `${hintId} ${errorId}`;

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="repository-form" onSubmit={submit}>
      <label className="field-label" htmlFor="repository">
        {t(locale, "home.repositoryLabel")}
      </label>
      <div className="repository-control">
        <span aria-hidden="true" className="repository-prompt">git/</span>
        <input
          aria-describedby={describedBy}
          aria-invalid={errorId === undefined ? undefined : true}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          disabled={submitting}
          id="repository"
          name="repository"
          onChange={(event) => { onRepositoryChange(event.target.value); }}
          placeholder={t(locale, "home.repositoryPlaceholder")}
          spellCheck={false}
          type="text"
          value={repository}
        />
        <button disabled={submitting} type="submit">
          <span>{t(locale, submitting ? "home.submitting" : "home.submit")}</span>
          <span aria-hidden="true" className="button-current" />
        </button>
      </div>
      <p className="field-hint" id={hintId}>{t(locale, "home.repositoryHint")}</p>
      <p className="privacy-note">
        <span aria-hidden="true" className="privacy-mark" />
        {t(locale, "home.noLogin")}
      </p>
    </form>
  );
}
