import { addDays, todayKey } from './dates';
import { Drill, Problem } from './types';
import { POINTS_PER_DRILL, POINTS_PER_SHEET, STEPS, titleFor } from './words';

/** 各ステップが「型どおりに埋まっているか」 */
export function stepComplete(p: Problem, i: number): boolean {
  switch (i) {
    case 0: return !!(p.ideal.trim() && p.current.trim() && p.gap.trim());
    case 1: return p.whys.filter((w) => w.trim()).length >= 3 && !!p.rootCause.trim();
    case 2: return p.ideas.length >= 3;
    case 3: return !!p.chosenIdeaId && p.ideas.length > 0 && p.ideas.every((x) => x.effect > 0 && x.effort > 0);
    case 4: return p.actions.length > 0 && p.actions.every((a) => !!a.due);
    case 5: return p.status === 'done' && !!p.outcome && !!p.learning.trim();
    default: return false;
  }
}

export function overdueCount(p: Problem, today = todayKey()): number {
  return p.actions.filter((a) => !a.done && a.due && a.due < today).length;
}

export interface Stats {
  points: number;
  title: string;
  next: { name: string; remain: number } | null;
  doneSheets: number;
  solved: number;
  active: number;
  drills: number;
  streak: number;
  drilledToday: boolean;
  /** ステップごとの充実度（%）。対象は「そのステップまで進んだ」シート */
  stepRates: (number | null)[];
  /** いちばん伸ばしたいステップ（データ不足なら null） */
  weakStep: number | null;
}

export function calcStats(problems: Problem[], drills: Drill[]): Stats {
  const doneSheets = problems.filter((p) => p.status === 'done').length;
  const solved = problems.filter((p) => p.status === 'done' && p.outcome === 'solved').length;
  const points = doneSheets * POINTS_PER_SHEET + drills.length * POINTS_PER_DRILL;
  const t = titleFor(points);

  const days = new Set(drills.map((d) => d.dateKey));
  const today = todayKey();
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const stepRates = STEPS.map((_, i) => {
    const targets = problems.filter((p) => p.status === 'done' || p.step > i);
    if (!targets.length) return null;
    return Math.round((targets.filter((p) => stepComplete(p, i)).length / targets.length) * 100);
  });
  let weakStep: number | null = null;
  stepRates.forEach((r, i) => {
    if (r === null || r >= 100) return;
    if (weakStep === null || r < (stepRates[weakStep] ?? 101)) weakStep = i;
  });

  return {
    points,
    title: t.name,
    next: t.next,
    doneSheets,
    solved,
    active: problems.length - doneSheets,
    drills: drills.length,
    streak,
    drilledToday: days.has(today),
    stepRates,
    weakStep,
  };
}
