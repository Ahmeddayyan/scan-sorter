import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatPageNumber, parsePageNumberInput } from '../core';
import { useActions, useApp } from '../state';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PageImage } from './PageImage';
import { pageAspect } from './pageAspect';
import './NumberEditor.css';

/** Dialog for fixing one page's number. Mount with a page id; unmounts itself via onClose. */
export function NumberEditor({ pageId }: { pageId: string }) {
  const { state, result } = useApp();
  const { setNumber, resetNumber, openEditor } = useActions();
  const page = state.pages[pageId];
  const assignment = result.assignments[pageId];
  const hasOverride = Object.prototype.hasOwnProperty.call(state.overrides.numbers, pageId);

  const [text, setText] = useState(() => (assignment?.number ? formatPageNumber(assignment.number) : ''));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => openEditor(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // The page may disappear (removed / undo) while the dialog is open.
  useEffect(() => {
    if (!page) openEditor(null);
  }, [page, openEditor]);
  if (!page) return null;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '') {
      setError('Type a page number, or choose “This page has no number”.');
      inputRef.current?.focus();
      return;
    }
    const parsed = parsePageNumberInput(text);
    if (!parsed) {
      setError('Use a number like 17, or a roman numeral like iv.');
      inputRef.current?.focus();
      return;
    }
    setNumber(pageId, parsed);
    close();
  };

  const suggestions = (assignment?.suggestions ?? []).map((n) => formatPageNumber(n));
  const unique = [...new Set(suggestions)];

  return (
    <Modal labelledBy="number-editor-title" onClose={close}>
      <form className="modal__body number-editor" onSubmit={submit} noValidate>
        <div className="number-editor__head">
          <div className="number-editor__thumb">
            <PageImage
              src={page.thumbnail?.url ?? null}
              aspect={pageAspect(page)}
              rotation={state.overrides.rotations[pageId] ?? 0}
              alt=""
            />
          </div>
          <div className="number-editor__intro">
            <h2 id="number-editor-title" className="modal__title">
              Page number
            </h2>
            <p className="muted number-editor__label">{page.label}</p>
            {assignment?.reason ? <p className="muted number-editor__reason">{assignment.reason}</p> : null}
          </div>
        </div>

        <div className="number-editor__field">
          <label htmlFor="number-editor-input">What number is printed on this page?</label>
          <input
            id="number-editor-input"
            ref={inputRef}
            className="number-editor__input num"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'number-editor-error' : 'number-editor-hint'}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p id="number-editor-error" className="number-editor__error" role="alert">
              <Icon name="alert" /> {error}
            </p>
          ) : (
            <p id="number-editor-hint" className="muted number-editor__hint">
              Numbers like 17, or roman numerals like iv for front matter.
            </p>
          )}
        </div>

        {unique.length > 0 ? (
          <div className="number-editor__chips" role="group" aria-label="Suggested numbers">
            <span className="muted">Maybe:</span>
            {unique.map((s) => (
              <button
                key={s}
                type="button"
                className="chip num"
                onClick={() => {
                  const parsed = parsePageNumberInput(s);
                  if (parsed) {
                    setNumber(pageId, parsed);
                    close();
                  }
                }}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <div className="number-editor__secondary">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setNumber(pageId, null);
              close();
            }}
          >
            This page has no number
          </button>
          {hasOverride ? (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                resetNumber(pageId);
                close();
              }}
            >
              <Icon name="undo" /> Reset to automatic
            </button>
          ) : null}
        </div>

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save number
          </button>
        </div>
      </form>
    </Modal>
  );
}
