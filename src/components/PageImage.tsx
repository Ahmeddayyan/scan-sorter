import type { CSSProperties } from 'react';
import type { Rotation } from '../core';
import './PageImage.css';

interface PageImageProps {
  src: string | null;
  /** Natural aspect ratio (width / height) of `src`. */
  aspect: number;
  rotation: Rotation;
  alt: string;
  pending?: boolean;
  className?: string;
  /** Pixel size hint for the lightbox; omit for fluid (card) sizing. */
  style?: CSSProperties;
}

/**
 * Shows an image rotated by `rotation` inside a box that has the ROTATED aspect ratio, so
 * 90/270 turns neither overflow nor leave gaps. Rotation is purely visual (CSS transform).
 */
export function PageImage({ src, aspect, rotation, alt, pending, className, style }: PageImageProps) {
  const sideways = rotation === 90 || rotation === 270;
  const boxAspect = sideways ? 1 / aspect : aspect;
  const vars = { '--ar': boxAspect, '--a': aspect, '--rot': `${rotation}deg`, ...style } as CSSProperties;
  return (
    <div
      className={`page-image${sideways ? ' is-sideways' : ''}${pending ? ' is-pending' : ''}${className ? ` ${className}` : ''}`}
      style={vars}
    >
      {src ? <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} /> : null}
    </div>
  );
}
