import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DuplicateKind, PageAssignment, PageRecord, Rotation } from '../core';
import { badgeInfo } from '../state';
import { Icon, type IconName } from './Icon';
import { PageImage } from './PageImage';
import { pageAspect } from './pageAspect';
import './PageCard.css';

const BADGE_ICON: Record<string, IconName | null> = {
  none: null,
  alert: 'alert',
  copy: 'copy',
  pencil: 'pencil',
  help: 'help',
  spinner: 'spinner',
};

interface PageCardProps {
  page: PageRecord;
  assignment: PageAssignment | undefined;
  issue: DuplicateKind | null;
  rotation: Rotation;
  position: number;
  total: number;
  highlighted: boolean;
  dragDisabled: boolean;
  onEdit: (pageId: string) => void;
  onRotate: (pageId: string) => void;
  onRemove: (pageId: string) => void;
  onPreview: (pageId: string) => void;
}

function PageCardImpl({
  page,
  assignment,
  issue,
  rotation,
  position,
  total,
  highlighted,
  dragDisabled,
  onEdit,
  onRotate,
  onRemove,
  onPreview,
}: PageCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled: dragDisabled,
  });
  const badge = badgeInfo(page, assignment, issue);
  const iconName = BADGE_ICON[badge.icon] ?? null;
  const pending = page.status === 'pending' || page.status === 'analyzing';
  const spoken = `Position ${position} of ${total}. ${badge.text === '?' ? 'No page number' : badge.text}. ${page.label}`;

  return (
    <li
      ref={setNodeRef}
      id={`tile-${page.id}`}
      tabIndex={-1}
      className={`page-card${highlighted ? ' is-highlighted' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={spoken}
    >
      <div className="page-card__thumb">
        <button
          type="button"
          className="page-card__open"
          onClick={() => onPreview(page.id)}
          aria-label={`Open large preview of ${page.label}`}
          disabled={!page.thumbnail}
        >
          <PageImage
            src={page.thumbnail?.url ?? null}
            aspect={pageAspect(page)}
            rotation={rotation}
            alt=""
            pending={pending}
          />
        </button>
      </div>
      {/* Badge sits below the thumbnail so it never hides a printed header number. */}
      <div className="page-card__info">
        <button
          type="button"
          className={`badge badge--${badge.tone} page-card__badge`}
          title={badge.description}
          onClick={() => onEdit(page.id)}
          aria-label={`${badge.text === '?' ? 'No page number' : `Page number ${badge.text}`}. ${badge.description} Edit number.`}
        >
          {iconName ? <Icon name={iconName} className={badge.icon === 'spinner' ? 'spinner' : undefined} /> : null}
          <span className="num">{badge.text}</span>
        </button>
        <div className="page-card__meta" title={page.label}>
          {page.label}
        </div>
      </div>
      <div className="page-card__actions">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="icon-btn page-card__grip"
          aria-label={`Move ${page.label}`}
          disabled={dragDisabled}
          {...attributes}
          {...listeners}
        >
          <Icon name="grip" />
        </button>
        <button type="button" className="icon-btn" onClick={() => onEdit(page.id)} aria-label={`Edit page number of ${page.label}`}>
          <Icon name="pencil" />
        </button>
        <button type="button" className="icon-btn" onClick={() => onRotate(page.id)} aria-label={`Rotate ${page.label} a quarter turn`}>
          <Icon name="rotate" />
        </button>
        <button type="button" className="icon-btn" onClick={() => onRemove(page.id)} aria-label={`Remove ${page.label}`}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}

export const PageCard = memo(PageCardImpl);
