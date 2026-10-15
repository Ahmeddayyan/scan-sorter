import { describeProgress, plural, useActions, useApp } from '../state';
import { Icon } from './Icon';
import './ProcessingPanel.css';

/** Progress while reading, or a short "stopped" note after cancelling. */
export function ProcessingPanel() {
  const { state, queuedFiles } = useApp();
  const { cancel } = useActions();
  const { progress, running } = state;

  if (!running && progress.phase === 'cancelled') {
    const unread = Object.values(state.pages).filter((p) => p.status === 'error' && p.error?.startsWith('Not read')).length;
    return (
      <div className="processing processing--stopped" role="status">
        <Icon name="info" />
        <p>
          Stopped.{' '}
          {unread > 0
            ? `${plural(unread, 'page')} ${unread === 1 ? 'was' : 'were'} not read, so ${unread === 1 ? 'it shows' : 'they show'} as unnumbered. You can set numbers by hand or start over.`
            : 'Everything that was read so far is shown below.'}
        </p>
      </div>
    );
  }
  if (!running) return null;

  const view = describeProgress(progress, queuedFiles);
  return (
    <section className="processing" aria-label="Reading progress">
      <div className="processing__top">
        <Icon name="spinner" className="spinner processing__spinner" />
        <div className="processing__text">
          <strong>{view.title}</strong>
          {view.detail ? <span className="muted processing__detail">{view.detail}</span> : null}
        </div>
        <button type="button" className="btn btn--sm" onClick={cancel}>
          Cancel
        </button>
      </div>
      <div className="processing__bar-row">
        <progress
          className="processing__bar"
          max={1}
          value={view.fraction ?? undefined}
          aria-label="Pages read"
        />
        {view.counts ? <span className="num muted processing__counts">{view.counts}</span> : null}
      </div>
    </section>
  );
}
