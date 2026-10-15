import { useState } from 'react';
import { plural, useActions, useApp } from '../state';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { useFilePicker } from './useFilePicker';
import './Toolbar.css';

export function Toolbar() {
  const { state, result, canUndo, canRedo } = useApp();
  const actions = useActions();
  const { input, pick } = useFilePicker();
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = state.running;
  const pageCount = result.report.summary.pages;

  return (
    <div className="toolbar" role="toolbar" aria-label="Actions">
      <div className="toolbar__group">
        <button type="button" className="btn" onClick={pick}>
          <Icon name="plus" /> <span>Add files</span>
        </button>
        {input}
        <button type="button" className="btn btn--ghost toolbar__icon-btn" onClick={actions.undo} disabled={!canUndo} aria-label="Undo">
          <Icon name="undo" /> <span className="toolbar__label">Undo</span>
        </button>
        <button type="button" className="btn btn--ghost toolbar__icon-btn" onClick={actions.redo} disabled={!canRedo} aria-label="Redo">
          <Icon name="redo" /> <span className="toolbar__label">Redo</span>
        </button>
        {result.manualOrder ? (
          <button type="button" className="btn toolbar__auto-order" onClick={actions.restoreAutoOrder}>
            <Icon name="sort" /> <span>Back to automatic order</span>
          </button>
        ) : null}
      </div>
      <div className="toolbar__group toolbar__group--end">
        <button type="button" className="btn btn--ghost btn--danger" onClick={() => setConfirmReset(true)}>
          <Icon name="trash" /> <span>Start over</span>
        </button>
      </div>
      <button
        type="button"
        className="btn btn--primary btn--lg toolbar__download"
        onClick={actions.requestExport}
        disabled={busy || pageCount === 0}
        title={busy ? 'Wait until all pages are read' : undefined}
      >
        <Icon name="download" /> <span>Download sorted PDF</span>
      </button>
      {confirmReset ? (
        <ConfirmDialog
          title="Start over?"
          confirmLabel="Start over"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            actions.startOver();
          }}
        >
          <p>
            This clears {plural(Object.keys(state.pages).length, 'page')} and your changes from this screen. Your
            original files are not touched.
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
