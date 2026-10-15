import { useApp } from '../state';

/** Polite screen-reader announcements for progress and edits. Visually hidden. */
export function LiveRegion() {
  const { state } = useApp();
  const { text, nonce } = state.ui.announcement;
  // A trailing non-breaking space on alternate announcements makes repeats of the same text re-read.
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
      {nonce % 2 === 0 ? ' ' : ''}
    </div>
  );
}
