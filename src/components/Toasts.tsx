import { useEffect } from 'react';
import type { Notice } from '../state';
import { useActions, useApp } from '../state';
import { Icon } from './Icon';
import './Toasts.css';

const LIFETIME_MS: Record<Notice['kind'], number> = { info: 6000, success: 6000, error: 12000 };

function Toast({ notice }: { notice: Notice }) {
  const { dismissNotice, undo } = useActions();
  useEffect(() => {
    const id = setTimeout(() => dismissNotice(notice.id), notice.undo ? 9000 : LIFETIME_MS[notice.kind]);
    return () => clearTimeout(id);
  }, [notice, dismissNotice]);
  const icon = notice.kind === 'error' ? 'alert' : notice.kind === 'success' ? 'check' : 'info';
  return (
    <li className={`toast toast--${notice.kind}`}>
      <Icon name={icon} />
      <span className="toast__text">{notice.text}</span>
      {notice.undo ? (
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            undo();
            dismissNotice(notice.id);
          }}
        >
          <Icon name="undo" /> Undo
        </button>
      ) : null}
      <button type="button" className="icon-btn" onClick={() => dismissNotice(notice.id)} aria-label="Dismiss message">
        <Icon name="x" />
      </button>
    </li>
  );
}

/** Transient messages (also announced by the live region; not role=alert to avoid double speech). */
export function Toasts() {
  const { state } = useApp();
  if (state.ui.notices.length === 0) return null;
  return (
    <ul className="toasts" aria-label="Messages">
      {state.ui.notices.map((n) => (
        <Toast key={n.id} notice={n} />
      ))}
    </ul>
  );
}
