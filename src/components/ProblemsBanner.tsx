import { plural, useActions, useApp } from '../state';
import { Icon } from './Icon';
import './ProblemsBanner.css';

/** Non-intrusive list of per-file / per-page pipeline errors. */
export function ProblemsBanner() {
  const { state } = useApp();
  const { clearErrors } = useActions();
  const { errors } = state;
  if (errors.length === 0) return null;
  return (
    <details className="problems">
      <summary className="problems__summary">
        <Icon name="alert" />
        <span>
          {plural(errors.length, 'problem')} while reading your files. Everything else was kept.
        </span>
        <span className="problems__toggle link-btn">Details</span>
      </summary>
      <ul className="problems__list">
        {errors.map((error, i) => (
          <li key={i}>
            <strong>{error.fileName ?? (error.pageId ? state.pages[error.pageId]?.label : null) ?? 'A file'}:</strong>{' '}
            {error.message}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--sm" onClick={clearErrors}>
        Dismiss
      </button>
    </details>
  );
}
