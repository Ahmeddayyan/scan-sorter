import { useActions, useApp } from '../state';
import { Icon } from './Icon';
import { Modal } from './Modal';
import './ExportDialog.css';

/** Pre-download confirmation, progress and friendly failure message. */
export function ExportDialog() {
  const { state } = useApp();
  const actions = useActions();
  const status = state.ui.exportStatus;

  if (status.phase === 'idle') return null;

  if (status.phase === 'confirm') {
    return (
      <Modal labelledBy="export-title" onClose={actions.dismissExport}>
        <div className="modal__body">
          <h2 id="export-title" className="modal__title">
            Download anyway?
          </h2>
          <ul className="export-warnings">
            {status.warnings.map((w) => (
              <li key={w}>
                <Icon name="alert" /> {w}
              </li>
            ))}
          </ul>
          <p className="muted">
            You can go back and fix this first, or download now. Missing pages are simply left out of the PDF.
          </p>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={actions.dismissExport}>
              Go back
            </button>
            <button type="button" className="btn btn--primary" onClick={actions.confirmExport}>
              <Icon name="download" /> Download anyway
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (status.phase === 'working') {
    const fraction = status.total > 0 ? status.done / status.total : null;
    return (
      <Modal labelledBy="export-title" onClose={actions.cancelExport} dismissible={false}>
        <div className="modal__body" role="status">
          <h2 id="export-title" className="modal__title">
            Creating your PDF{'…'}
          </h2>
          <progress className="export-bar" max={1} value={fraction ?? undefined} aria-label="Pages added" />
          <p className="muted num">
            {status.done} of {status.total} pages added. This happens on your device.
          </p>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={actions.cancelExport}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal labelledBy="export-title" onClose={actions.dismissExport}>
      <div className="modal__body">
        <h2 id="export-title" className="modal__title">
          We couldn{'’'}t create the PDF
        </h2>
        <p className="export-error" role="alert">
          <Icon name="alert" /> {status.message}
        </p>
        <p className="muted">Your pages and changes are still here. You can try again.</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={actions.dismissExport}>
            Close
          </button>
          <button type="button" className="btn btn--primary" onClick={actions.confirmExport}>
            Try again
          </button>
        </div>
      </div>
    </Modal>
  );
}
