import type { CandidateKind, CandidateMatch } from './types';

const DM_SENTINEL_PATTERN = /\bdm:([@\w.+-]+)/g;
const CHANNEL_REF_PATTERN = /(^|[\s(])#([a-z0-9._-]+)/gi;
const MESSAGE_LINK_PATTERN = /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d{16}/gi;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\([^)]+\)/g;
const WIKILINK_PATTERN = /\[\[[^[\]]+]]/g;

export function detectCandidates(
  text: string,
  input: {
    cursorOffset: number;
  }
): CandidateMatch[] {
  const excludedRanges = getExcludedRanges(text);
  const candidates: CandidateMatch[] = [];

  addMatches(candidates, text, MESSAGE_LINK_PATTERN, 'message-permalink', excludedRanges, input.cursorOffset);
  addMatches(candidates, text, DM_SENTINEL_PATTERN, 'dm-sentinel', excludedRanges, input.cursorOffset);

  for (const match of text.matchAll(CHANNEL_REF_PATTERN)) {
    const prefix = match[1] ?? '';
    const value = `#${match[2]}`;
    const start = (match.index ?? 0) + prefix.length;
    const end = start + value.length;

    if (!shouldSkipCandidate(start, end, excludedRanges, input.cursorOffset)) {
      candidates.push({ end, kind: 'channel-ref', start, value });
    }
  }

  return candidates.sort((left, right) => left.start - right.start);
}

function addMatches(
  candidates: CandidateMatch[],
  text: string,
  pattern: RegExp,
  kind: CandidateKind,
  excludedRanges: Array<{ end: number; start: number }>,
  cursorOffset: number
): void {
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;

    if (!shouldSkipCandidate(start, end, excludedRanges, cursorOffset)) {
      candidates.push({ end, kind, start, value });
    }
  }
}

function getExcludedRanges(text: string): Array<{ end: number; start: number }> {
  const ranges = collectRanges(text, MARKDOWN_LINK_PATTERN);

  for (const range of collectRanges(text, WIKILINK_PATTERN)) {
    ranges.push(range);
  }

  const frontmatterRange = getFrontmatterRange(text);

  if (frontmatterRange) {
    ranges.push(frontmatterRange);
  }

  return ranges;
}

function collectRanges(text: string, pattern: RegExp): Array<{ end: number; start: number }> {
  const ranges: Array<{ end: number; start: number }> = [];

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    ranges.push({ end: start + match[0].length, start });
  }

  return ranges;
}

function getFrontmatterRange(text: string): { end: number; start: number } | null {
  if (!text.startsWith('---\n')) {
    return null;
  }

  const closingIndex = text.indexOf('\n---\n', 4);

  if (closingIndex === -1) {
    return null;
  }

  return { end: closingIndex + 5, start: 0 };
}

function shouldSkipCandidate(
  start: number,
  end: number,
  excludedRanges: Array<{ end: number; start: number }>,
  cursorOffset: number
): boolean {
  if (cursorOffset >= start && cursorOffset <= end) {
    return true;
  }

  return excludedRanges.some((range) => start < range.end && end > range.start);
}
