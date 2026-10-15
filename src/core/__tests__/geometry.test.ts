import { describe, expect, it } from 'vitest';
import { bandRects, normalizeBandBox, normalizeBox, regionOf, unionBoxes } from '../geometry';

describe('geometry', () => {
  it('bandRects gives top and bottom 15 % by default', () => {
    const r = bandRects(1000, 2000);
    expect(r.top).toEqual({ x: 0, y: 0, width: 1000, height: 300 });
    expect(r.bottom).toEqual({ x: 0, y: 1700, width: 1000, height: 300 });
  });

  it('normalizeBox and normalizeBandBox map into [0,1] page space', () => {
    expect(normalizeBox({ x: 100, y: 1800, width: 50, height: 20 }, 1000, 2000)).toEqual({ x: 0.1, y: 0.9, w: 0.05, h: 0.01 });
    const band = bandRects(1000, 2000).bottom;
    // crop rendered at 2x: 2000x600 px
    const box = normalizeBandBox({ x: 200, y: 400, width: 100, height: 40 }, band, { width: 1000, height: 2000 }, { width: 2000, height: 600 });
    expect(box.x).toBeCloseTo(0.1);
    expect(box.y).toBeCloseTo(0.95);
    expect(box.w).toBeCloseTo(0.05);
    expect(box.h).toBeCloseTo(0.01);
  });

  it('classifies regions by centre', () => {
    expect(regionOf({ x: 0.45, y: 0.94, w: 0.1, h: 0.02 })).toBe('bottom-center');
    expect(regionOf({ x: 0.05, y: 0.02, w: 0.05, h: 0.02 })).toBe('top-left');
    expect(regionOf({ x: 0.9, y: 0.02, w: 0.05, h: 0.02 })).toBe('top-right');
    expect(regionOf({ x: 0.9, y: 0.9, w: 0.05, h: 0.02 })).toBe('bottom-right');
    expect(regionOf({ x: 0.5, y: 0.5, w: 0.05, h: 0.02 })).toBe('body');
    expect(regionOf({ x: 0.5, y: 0.2, w: 0.05, h: 0.02 }, { top: 0.25, bottom: 0.1 })).toBe('top-center');
  });

  it('unions boxes', () => {
    expect(unionBoxes([{ x: 0.25, y: 0.25, w: 0.25, h: 0.25 }, { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }])).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(unionBoxes([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
