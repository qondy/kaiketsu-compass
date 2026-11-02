import { todayKey } from './dates';
import { IssueKey, Problem } from './types';
import { STEPS } from './words';

/** 診断で見つかった課題 */
export interface Issue {
  key: IssueKey;
  /** 関係するステップ（0〜5） */
  step: number;
  title: string;
  /** 根拠となる数字 */
  evidence: string;
  /** 直し方 */
  advice: string;
  /** 深刻さ 0〜1 */
  severity: number;
}

export interface Diagnosis {
  ready: boolean;
  /** 診断できるまでにあと何件進めればよいか */
  remain: number;
  issues: Issue[];
  /** できていること */
  goods: string[];
}

/** 診断を始めるのに必要な「なぜなぜ分析」以降まで進めたシートの数 */
const MIN_SHEETS = 2;
const STALL_DAYS = 7;
const MAX_ISSUES = 3;

const passed = (p: Problem, step: number): boolean => p.status === 'done' || p.step > step;
const avg = (nums: number[]): number => nums.reduce((a, b) => a + b, 0) / nums.length;
const fmt = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);
const clamp = (n: number): number => Math.min(1, Math.max(0, n));

/** 止まりやすいステップごとの直し方 */
const STALL_ADVICE = [
  'まずは「あるべき姿」だけ1行で書いて、次へ進んでしまいましょう。完璧な定義はあとから直せます。',
  '「なぜ？」に正解はありません。思いついた理由を仮で書いて進め、違ったら戻ればOKです。',
  '良し悪しを判断せずに、くだらない案も含めて5つ書き出すと手が止まりにくくなります。',
  '迷ったら「効果が大きい順」に1つ選ぶだけでOK。選び直しはいつでもできます。',
  '行動を「今日5分でできる大きさ」まで小さくすると、計画が動き出します。',
  '結果が出ていなくても、途中経過をふりかえれば1件の踏破になります。',
];

export function diagnose(problems: Problem[], today = todayKey()): Diagnosis {
  const progressed = problems.filter((p) => passed(p, 1)).length;
  if (progressed < MIN_SHEETS) {
    return { ready: false, remain: MIN_SHEETS - progressed, issues: [], goods: [] };
  }

  const issues: Issue[] = [];
  const goods: string[] = [];
  const done = problems.filter((p) => p.status === 'done');

  // ① 問題の定義：現状に数字・事実が入っているか
  const defined = problems.filter((p) => passed(p, 0) && p.current.trim());
  if (defined.length >= 2) {
    const withNum = defined.filter((p) => /[0-9０-９]/.test(p.current)).length;
    const rate = withNum / defined.length;
    if (rate < 0.5) {
      issues.push({
        key: 'define', step: 0,
        title: '現状があいまいになりがち',
        evidence: `「現状」に数字が入っているシート ${withNum} / ${defined.length}件`,
        advice: '現状は「平均70分」「週2回」のように数字で書くと、あるべき姿との差がはっきりして、打ち手も選びやすくなります。',
        severity: clamp(0.8 - rate),
      });
    } else if (rate >= 0.8) {
      goods.push('現状を数字でとらえられています');
    }
  }

  // ② なぜなぜ分析：掘り下げの深さ
  const analyzed = problems.filter((p) => passed(p, 1));
  if (analyzed.length >= 2) {
    const depth = avg(analyzed.map((p) => p.whys.filter((w) => w.trim()).length));
    if (depth < 3) {
      issues.push({
        key: 'shallow', step: 1,
        title: '原因の掘り下げが浅め',
        evidence: `「なぜ」の平均 ${fmt(depth)}段（目安は3段以上）`,
        advice: '1つ目の「なぜ」は症状の言い換えになりがちです。「それはなぜ？」をあと1回だけ足すのを習慣にしましょう。',
        severity: clamp((3 - depth) / 3 + 0.1),
      });
    } else if (depth >= 3.5) {
      goods.push(`「なぜ」を平均${fmt(depth)}段まで掘れています`);
    }
  }

  // ③ 打ち手を出す：数
  const ideated = problems.filter((p) => passed(p, 2));
  if (ideated.length >= 2) {
    const count = avg(ideated.map((p) => p.ideas.length));
    if (count < 4) {
      issues.push({
        key: 'fewIdeas', step: 2,
        title: '打ち手の数が少なめ',
        evidence: `打ち手の平均 ${fmt(count)}個（目標は5個）`,
        advice: '最初に浮かんだ案で決めてしまうと、もっと良い案を見逃します。「やめる・減らす・人に頼む」の視点で数を足してみましょう。',
        severity: clamp((5 - count) / 5),
      });
    } else if (count >= 5) {
      goods.push(`打ち手を平均${fmt(count)}個出せています`);
    }
  }

  // ④ 評価して選ぶ：効果より手軽さで選んでいないか
  const chosen = problems
    .filter((p) => passed(p, 3))
    .map((p) => ({ p, c: p.ideas.find((i) => i.id === p.chosenIdeaId) }))
    .filter((x) => x.c && x.c.effect > 0);
  if (chosen.length >= 2) {
    const skipped = chosen.filter(({ p, c }) => p.ideas.some((i) => i.effect > (c?.effect ?? 0))).length;
    const rate = skipped / chosen.length;
    if (rate >= 0.5) {
      issues.push({
        key: 'easyBias', step: 3,
        title: '効果より手軽さで選びがち',
        evidence: `${chosen.length}件中 ${skipped}件で、もっと効果の大きい打ち手を見送っています`,
        advice: '手間が大きくても効果が大きい打ち手は、最初の一歩だけ小さく切り出せば動けます。「効果：大」から先に検討しましょう。',
        severity: clamp(rate - 0.1),
      });
    }
  }

  // ⑤ 行動計画：期限が来た行動を終えられているか
  const dueActions = problems.flatMap((p) => p.actions).filter((a) => a.due && a.due < today);
  if (dueActions.length >= 3) {
    const late = dueActions.filter((a) => !a.done).length;
    const rate = late / dueActions.length;
    if (rate >= 0.3) {
      issues.push({
        key: 'overdue', step: 4,
        title: '行動が期限を過ぎがち',
        evidence: `期限が過ぎた行動のうち ${late} / ${dueActions.length}件が未完了`,
        advice: '期限は「確実にできる日」に。最初の行動は今日〜明日にできる大きさまで小さくしましょう。',
        severity: clamp(rate),
      });
    } else if (rate === 0) {
      goods.push('行動を期限どおりにやり切れています');
    }
  }

  // 途中で止まりやすいステップ
  const active = problems.filter((p) => p.status === 'active');
  const staleMs = STALL_DAYS * 86400000;
  const stalled = active.filter((p) => Date.now() - p.updatedAt >= staleMs);
  if (stalled.length >= 2) {
    const byStep = STEPS.map((_, i) => stalled.filter((p) => p.step === i).length);
    const step = byStep.indexOf(Math.max(...byStep));
    issues.push({
      key: 'stall', step,
      title: `「${STEPS[step].label}」で止まりがち`,
      evidence: `進行中 ${active.length}件のうち ${stalled.length}件が${STALL_DAYS}日以上止まっています（うち「${STEPS[step].label}」${byStep[step]}件）`,
      advice: STALL_ADVICE[step],
      severity: clamp(stalled.length / active.length),
    });
  }

  // ⑥ ふりかえり：解決まで届いているか / 学びを残せているか
  const rated = done.filter((p) => p.outcome);
  if (rated.length >= 3) {
    const score = avg(rated.map((p) => (p.outcome === 'solved' ? 1 : p.outcome === 'partial' ? 0.5 : 0)));
    if (score < 0.4) {
      issues.push({
        key: 'unsolved', step: 0,
        title: '解決まで届きにくい',
        evidence: `踏破 ${rated.length}件のうち「解決した」は ${rated.filter((p) => p.outcome === 'solved').length}件`,
        advice: '問題が大きすぎるのかもしれません。「〇〇の中の△△だけ」のように、問題を小さく定義し直すと届きやすくなります。',
        severity: clamp(0.6 - score),
      });
    } else if (score >= 0.7) {
      goods.push('取り組んだ問題をしっかり解決できています');
    }
  }
  if (done.length >= 2) {
    const blank = done.filter((p) => !p.nextTime.trim()).length;
    if (blank / done.length >= 0.5) {
      issues.push({
        key: 'noLesson', step: 5,
        title: '学びを次に持ち越せていない',
        evidence: `踏破 ${done.length}件のうち ${blank}件で「次に活かすこと」が空欄`,
        advice: '1行でOK。次の問題でも使える「自分ルール」の形で書くと、学びの棚があなたの地図になります。',
        severity: clamp(blank / done.length - 0.2),
      });
    }
  }

  issues.sort((a, b) => b.severity - a.severity);
  return { ready: true, remain: 0, issues: issues.slice(0, MAX_ISSUES), goods: goods.slice(0, 2) };
}

/** 課題ごとの稽古の切り替え内容 */
export interface FocusDrill {
  label: string;
  point: string;
  causeLabel: string;
  causePlaceholder: string;
  ideasLabel: string;
  ideasPlaceholder: string;
  minIdeas: number;
  needsNumber: boolean;
}

export const FOCUS_DRILLS: Record<IssueKey, FocusDrill> = {
  define: {
    label: '現状を数字でとらえる',
    point: 'お題の「現状」を、数字や事実を入れて書いてみましょう。思い込みではなく、測れる形にするのがコツです。',
    causeLabel: '現状を数字・事実で書くと？',
    causePlaceholder: '例：会議は週3回、毎回予定より平均30分オーバーしている',
    ideasLabel: '打ち手',
    ideasPlaceholder: '例：議題とゴールを前日までに共有する',
    minIdeas: 1,
    needsNumber: true,
  },
  shallow: {
    label: '「なぜ」を3段掘る',
    point: '「なぜ？」→「それはなぜ？」→「さらにそれはなぜ？」と3回以上たどってから、最後の答えを書きましょう。',
    causeLabel: '3回以上「なぜ」をたどった、いちばん深い原因',
    causePlaceholder: '例：長い→議題がない→誰も事前に決めない→会議の目的が共有されていない',
    ideasLabel: '打ち手',
    ideasPlaceholder: '例：会議の目的を招待文に1行で書く',
    minIdeas: 1,
    needsNumber: false,
  },
  fewIdeas: {
    label: '打ち手を3つ出し切る',
    point: '良し悪しは判断せず、3つ全部埋めましょう。「やめる・減らす・人に頼む・道具を使う」の視点がヒントです。',
    causeLabel: 'いちばんの原因は？',
    causePlaceholder: '例：議題とゴールが事前に決まっていない',
    ideasLabel: '打ち手（3つすべて）',
    ideasPlaceholder: '例：会議そのものをやめてチャットにする',
    minIdeas: 3,
    needsNumber: false,
  },
  easyBias: {
    label: '効果の大きい打ち手を考える',
    point: '手間は気にせず「これが実現したら一気に解決する」という効果の大きい打ち手を考えましょう。',
    causeLabel: 'いちばんの原因は？',
    causePlaceholder: '例：議題とゴールが事前に決まっていない',
    ideasLabel: '効果が大きい打ち手（手間は気にしない）',
    ideasPlaceholder: '例：会議の運営ルールをチーム全体で作り直す',
    minIdeas: 1,
    needsNumber: false,
  },
  overdue: {
    label: '最初の一歩を小さく切る',
    point: '打ち手を「今日5分でできる最初の一歩」まで小さくして書きましょう。',
    causeLabel: 'いちばんの原因は？',
    causePlaceholder: '例：議題とゴールが事前に決まっていない',
    ideasLabel: '今日5分でできる最初の一歩',
    ideasPlaceholder: '例：次回の議題を3行でメモしてチャットに送る',
    minIdeas: 1,
    needsNumber: false,
  },
  stall: {
    label: '止まらずに最後まで書く',
    point: '完璧を目指さず、思いついたまま最後まで書き切る練習です。迷ったら仮の答えでOK。',
    causeLabel: 'いちばんの原因は？（仮でOK）',
    causePlaceholder: '例：たぶん、議題が決まっていないから',
    ideasLabel: '打ち手（仮でOK）',
    ideasPlaceholder: '例：とりあえずタイマーを置いてみる',
    minIdeas: 1,
    needsNumber: false,
  },
  unsolved: {
    label: '問題を小さく絞る',
    point: 'お題を「〇〇の中の△△だけ」のように半分の大きさに絞ってから、原因と打ち手を考えましょう。',
    causeLabel: '問題を半分の大きさに絞ると？',
    causePlaceholder: '例：月曜の定例だけ、毎回30分オーバーする',
    ideasLabel: '絞った問題への打ち手',
    ideasPlaceholder: '例：月曜の定例だけ議題を前日に共有する',
    minIdeas: 1,
    needsNumber: false,
  },
  noLesson: {
    label: '学びを自分ルールにする',
    point: 'お題を考えたあと、次に別の問題でも使える「自分ルール」を1つ言葉にしましょう。',
    causeLabel: 'いちばんの原因は？',
    causePlaceholder: '例：議題とゴールが事前に決まっていない',
    ideasLabel: '打ち手と、次に活かす自分ルール',
    ideasPlaceholder: '例：何かを始める前に「何が決まれば終わりか」を書く',
    minIdeas: 1,
    needsNumber: false,
  },
};

export const ISSUE_KEYS = Object.keys(FOCUS_DRILLS) as IssueKey[];

export function isIssueKey(v: unknown): v is IssueKey {
  return typeof v === 'string' && (ISSUE_KEYS as string[]).includes(v);
}
