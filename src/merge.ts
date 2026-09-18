import type { Subtitle } from './types';

/** 候选匹配的最低总分阈值，低于此分值的配对不进入 DP */
export const MERGE_MIN_SCORE = 0.45;
/** 文本分 / 时间分权重 */
const TEXT_WEIGHT = 0.6;
const TIME_WEIGHT = 0.4;
/** 浮点同分比较容差 */
const EPS = 1e-9;

export interface MergePair {
  /** 当前字幕在数组中的下标 */
  currentIndex: number;
  /** 修订稿字幕在数组中的下标 */
  revisionIndex: number;
  /** 加权总分 */
  score: number;
  /** 文本相似度分（0–1） */
  textScore: number;
  /** 时间区间 IoU 分（0–1） */
  timeScore: number;
}

export interface MergeResult {
  /** DP 求出的保持顺序的一对一匹配 */
  pairs: MergePair[];
  /** 未参与匹配的当前字幕下标 */
  unmatchedCurrent: number[];
  /** 未参与匹配的修订稿下标 */
  unmatchedRevision: number[];
}

/** 转小写、去首尾空白、折叠连续空白（按 Unicode 空白） */
export function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** 按 Unicode 码点拆分（代理对按一个字符计） */
function codePoints(s: string): string[] {
  return Array.from(s);
}

/** 两个码点序列的 Levenshtein 编辑距离 */
function levenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 文本相似度：1 − 编辑距离 / max(两侧字符数, 1) */
function textSimilarity(a: string[], b: string[]): number {
  const denom = Math.max(a.length, b.length, 1);
  return 1 - levenshtein(a, b) / denom;
}

/** 时间区间 IoU；无有效交集（交 ≤ 0）时为 0 */
function timeIoU(a: Subtitle, b: Subtitle): number {
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (inter <= 0) return 0;
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  if (union <= 0) return 0;
  return inter / union;
}

interface Prepared {
  sub: Subtitle;
  chars: string[];
}

// DP 回溯选择：1=配对，2=跳过修订稿（来自上方），3=跳过当前稿（来自左方）
const CHOICE_MATCH = 1;
const CHOICE_SKIP_REVISION = 2;
const CHOICE_SKIP_CURRENT = 3;

/**
 * 计算当前字幕与修订稿之间保持顺序的一对一最大总分匹配。
 * 仅保留总分 ≥ 0.45 的候选；同分时依次优先：匹配、跳过修订稿、跳过当前稿。
 */
export function alignSubtitles(current: Subtitle[], revision: Subtitle[]): MergeResult {
  const n = current.length;
  const m = revision.length;

  const prepA: Prepared[] = current.map((sub) => ({
    sub,
    chars: codePoints(normalizeText(sub.text)),
  }));
  const prepB: Prepared[] = revision.map((sub) => ({
    sub,
    chars: codePoints(normalizeText(sub.text)),
  }));

  /** 单元格候选分（含各分项），不达阈值返回 null */
  const cellScore = (
    a: Prepared,
    b: Prepared
  ): { score: number; textScore: number; timeScore: number } | null => {
    const timeScore = timeIoU(a.sub, b.sub);
    // 长度差给出的文本分上界：1 − |la−lb| / max(la,lb)；
    // 即使时间完全重合也过不了阈值时，直接跳过编辑距离计算。
    const maxLen = Math.max(a.chars.length, b.chars.length);
    const upper =
      maxLen === 0 ? 1 : 1 - Math.abs(a.chars.length - b.chars.length) / maxLen;
    if (TEXT_WEIGHT * upper + TIME_WEIGHT * timeScore < MERGE_MIN_SCORE - EPS) {
      return null;
    }
    const textScore = textSimilarity(a.chars, b.chars);
    const score = TEXT_WEIGHT * textScore + TIME_WEIGHT * timeScore;
    return score >= MERGE_MIN_SCORE - EPS ? { score, textScore, timeScore } : null;
  };

  // 序列对齐 DP（两行滚动），choice 记录每个格子的来源用于回溯
  let prev = new Array<number>(m + 1).fill(0);
  let cur = new Array<number>(m + 1).fill(0);
  const choice = new Uint8Array((n + 1) * (m + 1));

  for (let j = 1; j <= m; j++) choice[j] = CHOICE_SKIP_REVISION;

  for (let i = 1; i <= n; i++) {
    cur[0] = 0;
    choice[i * (m + 1)] = CHOICE_SKIP_CURRENT;
    for (let j = 1; j <= m; j++) {
      const sc = cellScore(prepA[i - 1], prepB[j - 1]);
      const match = sc === null ? -Infinity : prev[j - 1] + sc.score;
      const skipRevision = prev[j];
      const skipCurrent = cur[j - 1];
      const best = Math.max(match, skipRevision, skipCurrent);

      const offset = i * (m + 1) + j;
      if (sc !== null && match >= best - EPS) {
        cur[j] = match;
        choice[offset] = CHOICE_MATCH;
      } else if (skipRevision >= best - EPS) {
        cur[j] = skipRevision;
        choice[offset] = CHOICE_SKIP_REVISION;
      } else {
        cur[j] = skipCurrent;
        choice[offset] = CHOICE_SKIP_CURRENT;
      }
    }
    [prev, cur] = [cur, prev];
  }

  // 回溯
  const pairs: MergePair[] = [];
  const unmatchedCurrent: number[] = [];
  const unmatchedRevision: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const ch = choice[i * (m + 1) + j];
    if (i > 0 && j > 0 && ch === CHOICE_MATCH) {
      const sc = cellScore(prepA[i - 1], prepB[j - 1])!;
      pairs.push({
        currentIndex: i - 1,
        revisionIndex: j - 1,
        score: sc.score,
        textScore: sc.textScore,
        timeScore: sc.timeScore,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || ch === CHOICE_SKIP_REVISION)) {
      unmatchedRevision.push(j - 1);
      j--;
    } else {
      unmatchedCurrent.push(i - 1);
      i--;
    }
  }

  pairs.reverse();
  unmatchedCurrent.reverse();
  unmatchedRevision.reverse();
  return { pairs, unmatchedCurrent, unmatchedRevision };
}
