import { useEffect, useState, type KeyboardEvent } from 'react';
import { renderPagePreview } from '../pipeline';
import { badgeInfo, issueByPage, useActions, useApp } from '../state';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PageImage } from './PageImage';
import { pageAspect } from './pageAspect';
import './Lightbox.css';

const PREVIEW_SIZE = 1600;

/** Large preview of one page with prev/next (arrow keys) and quick actions. */
export function Lightbox({ pageId }: { pageId: string }) {
  const { state, result } = useApp();
  const { openLightbox, openEditor, rotate, removePages } = useActions();
  const page = state.pages[pageId];
  const index = result.order.indexOf(pageId);
  const rotation = state.overrides.rotations[pageId] ?? 0;
  const demo = state.demo;

  const [preview, setPreview] = useState<{ pageId: string; url: string } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === pageId;

  // Render a sharper image than the thumbnail. Falls back to the thumbnail on any failure.
  useEffect(() => {
    if (demo) return undefined;
    let cancelled = false;
    let created: string | null = null;
    renderPagePreview(pageId, PREVIEW_SIZE, 0)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setPreview({ pageId, url });
      })
      .catch(() => {
        if (!cancelled) setFailedFor(pageId);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [pageId, demo]);

  useEffect(() => {
    if (!page || index < 0) openLightbox(null);
  }, [page, index, openLightbox]);
  if (!page || index < 0) return null;

  const go = (delta: number) => {
    const next = result.order[index + delta];
    if (next !== undefined) openLightbox(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    }
  };

  const badge = badgeInfo(page, result.assignments[pageId], issueByPage(result.report).get(pageId) ?? null);
  const src = preview && preview.pageId === pageId ? preview.url : (page.thumbnail?.url ?? null);
  const aspect = pageAspect(page);

  return (
    <Modal labelledBy="lightbox-title" onClose={() => openLightbox(null)} wide onKeyDown={onKeyDown}>
      <div className="lightbox">
        <header className="lightbox__bar">
          <div className="lightbox__title">
            <h2 id="lightbox-title" className="modal__title">
              <span className={`badge badge--${badge.tone}`} title={badge.description}>
                <span className="num">{badge.text}</span>
              </span>{' '}
              <span className="lightbox__name">{page.label}</span>
            </h2>
            <p className="muted lightbox__sub num">
              Position {index + 1} of {result.order.length}
              {failed ? ' · showing the small preview' : ''}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={() => openLightbox(null)} aria-label="Close preview">
            <Icon name="x" />
          </button>
        </header>

        <div className="lightbox__stage">
          <button
            type="button"
            className="icon-btn lightbox__nav lightbox__nav--prev"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Previous page"
          >
            <Icon name="chevronLeft" />
          </button>
          <PageImage src={src} aspect={aspect} rotation={rotation} alt={`Preview of ${page.label}`} className="lightbox__image" />
          <button
            type="button"
            className="icon-btn lightbox__nav lightbox__nav--next"
            onClick={() => go(1)}
            disabled={index === result.order.length - 1}
            aria-label="Next page"
          >
            <Icon name="chevronRight" />
          </button>
        </div>

        <footer className="lightbox__actions">
          <button type="button" className="btn btn--sm" onClick={() => rotate(pageId)}>
            <Icon name="rotate" /> Rotate
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              openLightbox(null);
              openEditor(pageId);
            }}
          >
            <Icon name="pencil" /> Edit number
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => {
              const next = result.order[index + 1] ?? result.order[index - 1] ?? null;
              removePages([pageId], `Removed ${page.label}`);
              openLightbox(next);
            }}
          >
            <Icon name="trash" /> Remove page
          </button>
          <span className="muted lightbox__keys">Use the arrow keys to move between pages.</span>
        </footer>
      </div>
    </Modal>
  );
}
