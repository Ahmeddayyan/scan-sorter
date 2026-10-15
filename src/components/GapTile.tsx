import { gapLabel, type GapSlot } from '../state';
import { Icon } from './Icon';
import './PageCard.css';

export function GapTile({ slot, highlighted }: { slot: GapSlot; highlighted: boolean }) {
  return (
    <li id={`tile-${slot.id}`} tabIndex={-1} className={`gap-tile${highlighted ? ' is-highlighted' : ''}`}>
      <Icon name="gap" />
      <span className="gap-tile__title num">{gapLabel(slot)}</span>
      <span className="gap-tile__hint">Not found in your scans</span>
    </li>
  );
}
