import { useCallback, useEffect, useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Announcements,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { issueByPage, moveInOrder, useActions, useApp } from '../state';
import { GapTile } from './GapTile';
import { Icon } from './Icon';
import { PageCard } from './PageCard';
import './PageGrid.css';

export function PageGrid() {
  const { state, result } = useApp();
  const actions = useActions();
  const { removePages, setManualOrder, openEditor, openLightbox, rotate, restoreAutoOrder } = actions;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const issues = useMemo(() => issueByPage(result.report), [result.report]);
  const positions = useMemo(() => new Map(result.order.map((id, i) => [id, i + 1])), [result.order]);
  const highlighted = useMemo(() => new Set(state.ui.highlight.ids), [state.ui.highlight.ids]);
  const dragDisabled = state.running;

  // Scroll to / focus whatever the summary panel pointed at.
  const { ids: highlightIds, nonce } = state.ui.highlight;
  useEffect(() => {
    const first = highlightIds[0];
    if (first === undefined) return;
    const el = document.getElementById(`tile-${first}`);
    if (!el) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    // Only react to a new highlight request, not to the id list being cleared again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const onEdit = useCallback((id: string) => openEditor(id), [openEditor]);
  const onPreview = useCallback((id: string) => openLightbox(id), [openLightbox]);
  const onRemove = useCallback(
    (id: string) => {
      const label = state.pages[id]?.label;
      removePages([id], label ? `Removed ${label}` : undefined);
    },
    [removePages, state.pages],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = result.order.indexOf(String(active.id));
      const to = result.order.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      setManualOrder(moveInOrder(result.order, from, to), `Moved to position ${to + 1} of ${result.order.length}`);
    },
    [result.order, setManualOrder],
  );

  const announcements = useMemo<Announcements>(() => {
    const name = (id: string | number) => state.pages[String(id)]?.label ?? 'page';
    const pos = (id: string | number) => positions.get(String(id)) ?? 0;
    return {
      onDragStart: ({ active }) => `Picked up ${name(active.id)} from position ${pos(active.id)}.`,
      onDragOver: ({ active, over }) => (over ? `${name(active.id)} is over position ${pos(over.id)}.` : undefined),
      onDragEnd: ({ active, over }) =>
        over ? `Dropped ${name(active.id)} at position ${pos(over.id)}.` : `Dropped ${name(active.id)} where it was.`,
      onDragCancel: ({ active }) => `Move cancelled. ${name(active.id)} is back at position ${pos(active.id)}.`,
    };
  }, [state.pages, positions]);

  if (result.slots.length === 0) return null;

  return (
    <section className="page-grid" aria-label="Pages in order">
      {result.manualOrder ? (
        <div className="page-grid__manual" role="note">
          <Icon name="pencil" />
          <p>
            <strong>Order set by hand.</strong> Automatic sorting is paused, and missing-page tiles are hidden.
          </p>
          <button type="button" className="btn btn--sm" onClick={restoreAutoOrder}>
            <Icon name="sort" /> Back to automatic order
          </button>
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To reorder, press space or enter on the move handle, use the arrow keys to move the page, then press space or enter again to drop it. Press escape to cancel.',
          },
        }}
      >
        <SortableContext items={result.order} strategy={rectSortingStrategy}>
          <ol className="page-grid__list">
            {result.slots.map((slot) => {
              if (slot.kind === 'gap') {
                return <GapTile key={slot.id} slot={slot} highlighted={highlighted.has(slot.id)} />;
              }
              const page = state.pages[slot.pageId];
              if (!page) return null;
              return (
                <PageCard
                  key={slot.id}
                  page={page}
                  assignment={result.assignments[slot.pageId]}
                  issue={issues.get(slot.pageId) ?? null}
                  rotation={state.overrides.rotations[slot.pageId] ?? 0}
                  position={positions.get(slot.pageId) ?? 0}
                  total={result.order.length}
                  highlighted={highlighted.has(slot.pageId)}
                  dragDisabled={dragDisabled}
                  onEdit={onEdit}
                  onRotate={rotate}
                  onRemove={onRemove}
                  onPreview={onPreview}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  );
}
