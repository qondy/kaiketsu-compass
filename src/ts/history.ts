import { stepComplete } from './stats';
import { Problem } from './types';
import { STEPS } from './words';

const DAY = 86400000;

/** 1件の解決シートの「型の使いこなし」指標 */
export interface SheetMetrics {
  whys: number;
  ideas: number;
  /** 型どおりに埋まっているステップの数（0〜6） */
  form: number;
  /** 踏破までの日数（作成日から） */
  days: number;
}

export function sheetMetrics(p: Problem): SheetMetrics {
  return {
    whys: p.whys.filter((w) => w.trim()).length,
    ideas: p.ideas.length,
    form: STEPS.filter((_, i) => stepComplete(p, i)).length,
    days: Math.max(0, Math.round(((p.doneAt ?? p.updatedAt) - p.createdAt) / DAY)),
  };
}

/** 踏破したシートを古い順に並べる（No. はこの順番） */
export function doneSheetsAsc(problems: Problem[]): Problem[] {
  return problems
    .filter((p) => p.status === 'done')
    .sort((a, b) => (a.doneAt ?? a.updatedAt) - (b.doneAt ?? b.updatedAt));
}

export interface CompareRow {
  label: string;
  before: string;
  after: string;
  diff: string;
  /** improved: 伸びた / same: 変わらない / down: 下がった */
  trend: 'improved' | 'same' | 'down';
}

export interface Growth {
  /** 比較に使った件数（はじめ・最近それぞれ） */
  size: number;
  rows: CompareRow[];
  improvedCount: number;
}

/** 比較カードを出すのに必要な踏破件数 */
export const MIN_COMPARE = 4;
const GROUP_MAX = 3;

const avg = (nums: number[]): number => nums.reduce((a, b) => a + b, 0) / nums.length;
const outcomeScore = (p: Problem): number => (p.outcome === 'solved' ? 1 : p.outcome === 'partial' ? 0.5 : 0);
const one = (n: number): string => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');

interface Metric {
  label: string;
  value: (ps: Problem[]) => number;
  show: (n: number) => string;
  diff: (d: number) => string;
  /** 大きいほど良いか */
  higherIsBetter: boolean;
  /** 「変わらない」とみなす差 */
  epsilon: number;
}

const signed = (d: number, s: string): string => `${d > 0 ? '+' : '−'}${s}`;

const METRICS: Metric[] = [
  {
    label: '「なぜ」の段数',
    value: (ps) => avg(ps.map((p) => sheetMetrics(p).whys)),
    show: (n) => `${one(n)}段`,
    diff: (d) => signed(d, `${one(Math.abs(d))}段`),
    higherIsBetter: true,
    epsilon: 0.05,
  },
  {
    label: '打ち手の数',
    value: (ps) => avg(ps.map((p) => sheetMetrics(p).ideas)),
    show: (n) => `${one(n)}個`,
    diff: (d) => signed(d, `${one(Math.abs(d))}個`),
    higherIsBetter: true,
    epsilon: 0.05,
  },
  {
    label: '型の充実度',
    value: (ps) => avg(ps.map((p) => sheetMetrics(p).form)),
    show: (n) => `${one(n)} / 6`,
    diff: (d) => signed(d, one(Math.abs(d))),
    higherIsBetter: true,
    epsilon: 0.05,
  },
  {
    label: '解決できた割合',
    value: (ps) => avg(ps.map(outcomeScore)) * 100,
    show: (n) => `${Math.round(n)}%`,
    diff: (d) => signed(d, `${Math.round(Math.abs(d))}pt`),
    higherIsBetter: true,
    epsilon: 0.5,
  },
  {
    label: '踏破までの日数',
    value: (ps) => avg(ps.map((p) => sheetMetrics(p).days)),
    show: (n) => `${one(n)}日`,
    diff: (d) => signed(d, `${one(Math.abs(d))}日`),
    higherIsBetter: false,
    epsilon: 0.05,
  },
];

/** はじめの数件と最近の数件を比べる（件数が足りなければ null） */
export function compareGrowth(doneAsc: Problem[]): Growth | null {
  if (doneAsc.length < MIN_COMPARE) return null;
  const size = Math.min(GROUP_MAX, Math.floor(doneAsc.length / 2));
  const early = doneAsc.slice(0, size);
  const recent = doneAsc.slice(-size);
  const rows = METRICS.map((m): CompareRow => {
    const before = m.value(early);
    const after = m.value(recent);
    const d = after - before;
    let trend: CompareRow['trend'] = 'same';
    if (Math.abs(d) > m.epsilon) trend = (d > 0) === m.higherIsBetter ? 'improved' : 'down';
    return {
      label: m.label,
      before: m.show(before),
      after: m.show(after),
      diff: trend === 'same' ? '±0' : m.diff(d),
      trend,
    };
  });
  return { size, rows, improvedCount: rows.filter((r) => r.trend === 'improved').length };
}
