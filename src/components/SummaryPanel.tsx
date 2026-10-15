import { Fragment, useState, type ReactNode } from 'react';
import { formatPageNumber } from '../core';
import {
  allSafeToRemove,
  badgeText,
  formatRange,
  headline,
  missingSentence,
  plural,
  useActions,
  useApp,
  useMediaQuery,
} from '../state';
import { Icon, type IconName } from './Icon';
import './SummaryPanel.css';

const LIMIT = 6;

function Section({
  title,
  icon,
  tone,
  count,
  action,
  children,
}: {
  title: string;
  icon: IconName;
  tone: 'warn' | 'danger' | 'neutral' | 'info';
  count: number;
  action?: ReactNode;
  children: ReactNode[];
}) {
  const [all, setAll] = useState(false);
  const shown = all ? children : children.slice(0, LIMIT);
  return (
    <section className={`summary__section summary__section--${tone}`}>
      <header className="summary__section-head">
        <h3>
          <Icon name={icon} /> {title} <span className="summary__count num">{count}</span>
        </h3>
        {action}
      </header>
      <ul className="summary__list">{shown}</ul>
      {children.length > LIMIT ? (
        <button type="button" className="link-btn summary__more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${children.length}`}
        </button>
      ) : null}
    </section>
  );
}

export function SummaryPanel() {
  const { state, result } = useApp();
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const { report } = result;
  const head = headline(report, state.running);
  const pages = state.pages;
  const nameOf = (id: string) => pages[id]?.label ?? 'Unknown page';
  const safe = allSafeToRemove(report);

  const gapSlotFor = (range: { style: 'arabic' | 'roman'; from: number }) =>
    result.slots.find((s) => s.kind === 'gap' && s.from.style === range.style && s.from.value === range.from);

  const toneIcon: IconName = head.tone === 'ok' ? 'check' : head.tone === 'attention' ? 'alert' : 'info';
  // Below the desktop breakpoint the panel sits above the grid and collapses behind its header;
  // on desktop it is always open, so the header is plain content rather than a toggle button.
  const collapsible = useMediaQuery('(max-width: 899px)');

  const headContent = (
    <>
      <span className="summary__status-icon">
        <Icon name={toneIcon} />
      </span>
      <span className="summary__headline">
        <strong className="num">
          {head.parts.length > 0
            ? head.parts.map((part, i) => (
                // A breakable space between clauses; the separator travels with the clause.
                <Fragment key={part}>
                  {i > 0 ? ' ' : null}
                  <span className="summary__part">
                    {i > 0 ? '· ' : ''}
                    {part}
                  </span>
                </Fragment>
              ))
            : head.text}
        </strong>
        {head.detail ? <small className="muted num">{head.detail}</small> : null}
      </span>
    </>
  );

  return (
    <aside className={`summary${open ? ' is-open' : ''}`} aria-label="Summary of what was found">
      {collapsible ? (
        <button
          type="button"
          className={`summary__head summary__head--${head.tone}`}
          aria-expanded={open}
          aria-controls="summary-body"
          onClick={() => setOpen((v) => !v)}
        >
          {headContent}
          <Icon name="chevronDown" className="summary__chevron" />
        </button>
      ) : (
        <div className={`summary__head summary__head--${head.tone}`}>{headContent}</div>
      )}

      <div id="summary-body" className="summary__body">
        {report.missing.length > 0 ? (
          <Section title="Missing" icon="gap" tone="warn" count={report.summary.missing}>
            {report.missing.map((range) => {
              const slot = gapSlotFor(range);
              return (
                <li key={`${range.style}-${range.from}`}>
                  <button
                    type="button"
                    className="summary__item"
                    disabled={!slot}
                    title={slot ? undefined : 'Missing-page tiles are hidden while the order is set by hand'}
                    onClick={() => slot && actions.highlight([slot.id])}
                  >
                    <span className="num">{missingSentence(range)}</span>
                  </button>
                </li>
              );
            })}
          </Section>
        ) : null}

        {report.duplicates.length > 0 ? (
          <Section
            title="Duplicates"
            icon="copy"
            tone="danger"
            count={report.duplicates.length}
            action={
              safe.length > 0 ? (
                <button type="button" className="btn btn--sm" onClick={actions.removeDuplicateScans}>
                  <Icon name="trash" /> Remove duplicate scans
                </button>
              ) : null
            }
          >
            {report.duplicates.map((issue) => {
              const label = badgeText(issue.number).replace('p. ', '');
              const isScan = issue.kind === 'duplicate-scan';
              return (
                <li key={`${issue.kind}-${formatPageNumber(issue.number)}-${issue.number.style}`} className="summary__row">
                  <button
                    type="button"
                    className="summary__item"
                    onClick={() => actions.highlight(issue.pageIds)}
                  >
                    {isScan ? (
                      <span className="num">Page {label} was scanned twice</span>
                    ) : (
                      <span className="num">
                        {issue.pageIds.length} different pages all read as {label}. Please check.
                      </span>
                    )}
                  </button>
                  {isScan && issue.safeToRemove.length > 0 ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        actions.removePages(issue.safeToRemove, `Removed the extra scan of page ${label}`)
                      }
                    >
                      Remove extra
                    </button>
                  ) : null}
                </li>
              );
            })}
          </Section>
        ) : null}

        {report.unnumbered.length > 0 ? (
          <Section title="No page number" icon="help" tone="neutral" count={report.unnumbered.length}>
            {report.unnumbered.map((id) => (
              <li key={id} className="summary__row">
                <button type="button" className="summary__item" onClick={() => actions.highlight([id])}>
                  {nameOf(id)}
                </button>
                <button type="button" className="btn btn--sm" onClick={() => actions.openEditor(id)}>
                  Set number
                </button>
              </li>
            ))}
          </Section>
        ) : null}

        {report.lowConfidence.length > 0 ? (
          <Section title="Please confirm" icon="alert" tone="warn" count={report.lowConfidence.length}>
            {report.lowConfidence.map((entry) => (
              <li key={entry.pageId} className="summary__row">
                <button
                  type="button"
                  className="summary__item"
                  title={entry.reason}
                  onClick={() => actions.highlight([entry.pageId])}
                >
                  <span className="num">
                    {badgeText(entry.number)} <span className="muted">({Math.round(entry.confidence * 100)}% sure)</span>
                  </span>
                  <small className="muted">{nameOf(entry.pageId)}</small>
                </button>
                <span className="summary__row-actions">
                  {entry.number ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => actions.setNumber(entry.pageId, entry.number)}
                      aria-label={`Confirm ${badgeText(entry.number)} for ${nameOf(entry.pageId)}`}
                    >
                      Looks right
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => actions.openEditor(entry.pageId)}
                    aria-label={`Change the number of ${nameOf(entry.pageId)}`}
                  >
                    Change
                  </button>
                </span>
              </li>
            ))}
          </Section>
        ) : null}

        {report.notes.length > 0 || result.sequences.length > 0 ? (
          <section className="summary__section summary__section--info">
            <header className="summary__section-head">
              <h3>
                <Icon name="info" /> Notes
              </h3>
            </header>
            <ul className="summary__notes">
              {report.notes.map((note, i) => (
                <li key={`${note.kind}-${i}`}>{note.message}</li>
              ))}
              {result.sequences.map((seq) => (
                <li key={seq.style} className="muted num">
                  Numbering runs {formatRange({ style: seq.style, from: seq.min, to: seq.max }).replace(/^Pages? /, '')}{' '}
                  ({plural(seq.count, 'page')} found).
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.summary.removed > 0 ? (
          <p className="summary__removed muted num">
            {plural(report.summary.removed, 'page')} removed. Undo brings them back.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
