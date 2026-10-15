import { unionBoxes } from './geometry';
import type { NormBox, TextItem } from './types';

/** One whitespace-free word with its own box. */
export interface Token {
  text: string;
  box: NormBox;
  confidence: number;
  /** Index of the TextItem this token came from. */
  itemIndex: number;
}

/** A horizontal run of tokens on one line, separated from other runs by a wide gap. */
export interface Segment {
  tokens: Token[];
  /** Tokens joined by single spaces. */
  text: string;
  box: NormBox;
}

export interface Line {
  /** All tokens of the line, left to right. */
  tokens: Token[];
  /** The line split at wide horizontal gaps (running header text vs. the number at the margin). */
  segments: Segment[];
  box: NormBox;
}

/**
 * Split text items into single words. Text-layer runs such as "Page 12 of 40" become
 * four tokens whose boxes are distributed horizontally in proportion to character counts.
 */
export function tokenize(items: readonly TextItem[]): Token[] {
  const tokens: Token[] = [];
  items.forEach((item, itemIndex) => {
    const trimmed = item.text.trim();
    if (trimmed.length === 0) return;
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      tokens.push({ text: trimmed, box: item.box, confidence: item.confidence, itemIndex });
      return;
    }
    const totalChars = trimmed.length;
    let offset = 0;
    for (const part of parts) {
      const start = trimmed.indexOf(part, offset);
      offset = start + part.length;
      tokens.push({
        text: part,
        box: {
          x: item.box.x + item.box.w * (start / totalChars),
          y: item.box.y,
          w: item.box.w * (part.length / totalChars),
          h: item.box.h,
        },
        confidence: item.confidence,
        itemIndex,
      });
    }
  });
  return tokens;
}

interface LineAccumulator {
  tokens: Token[];
  cy: number;
  h: number;
}

/**
 * Group tokens into lines by vertical centre, then split each line into segments at
 * wide horizontal gaps. Lines are returned top to bottom, tokens left to right.
 */
export function buildLines(tokens: readonly Token[]): Line[] {
  const sorted = [...tokens].sort(
    (a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2) || a.box.x - b.box.x,
  );
  const acc: LineAccumulator[] = [];
  for (const t of sorted) {
    const cy = t.box.y + t.box.h / 2;
    let target: LineAccumulator | null = null;
    // Only the last few lines can still be close enough (input is sorted by y).
    for (let i = acc.length - 1; i >= 0 && i >= acc.length - 4; i -= 1) {
      const line = acc[i]!;
      const tol = 0.6 * Math.max(t.box.h, line.h, 0.004);
      if (Math.abs(cy - line.cy) <= tol) {
        target = line;
        break;
      }
    }
    if (target) {
      target.tokens.push(t);
      target.cy += (cy - target.cy) / target.tokens.length;
      target.h = Math.max(target.h, t.box.h);
    } else {
      acc.push({ tokens: [t], cy, h: t.box.h });
    }
  }
  return acc.map((line) => {
    const lineTokens = [...line.tokens].sort((a, b) => a.box.x - b.box.x);
    return {
      tokens: lineTokens,
      segments: splitSegments(lineTokens),
      box: unionBoxes(lineTokens.map((t) => t.box)),
    };
  });
}

function splitSegments(tokens: Token[]): Segment[] {
  if (tokens.length === 0) return [];
  let chars = 0;
  let width = 0;
  for (const t of tokens) {
    chars += t.text.length;
    width += t.box.w;
  }
  const charWidth = chars > 0 ? width / chars : 0.01;
  const gapThreshold = Math.max(2.5 * charWidth, 0.035);
  const groups: Token[][] = [[tokens[0]!]];
  for (let i = 1; i < tokens.length; i += 1) {
    const prev = tokens[i - 1]!;
    const cur = tokens[i]!;
    const gap = cur.box.x - (prev.box.x + prev.box.w);
    if (gap > gapThreshold) groups.push([cur]);
    else groups[groups.length - 1]!.push(cur);
  }
  return groups.map((g) => ({
    tokens: g,
    text: g.map((t) => t.text).join(' '),
    box: unionBoxes(g.map((t) => t.box)),
  }));
}
