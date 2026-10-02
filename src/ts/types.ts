/** 効果（大きいほど良い）/ 手間（小さいほど良い）の 3 段階評価。0 は未評価 */
export type Rating = 0 | 1 | 2 | 3;
export type Outcome = 'solved' | 'partial' | 'unsolved';
export type ProblemStatus = 'active' | 'done';

/** ステップ③で出した打ち手 */
export interface Idea {
  id: string;
  text: string;
  effect: Rating;
  effort: Rating;
}

/** ステップ⑤の行動計画 */
export interface Action {
  id: string;
  text: string;
  /** YYYY-MM-DD（未設定は空文字） */
  due: string;
  done: boolean;
}

/** 解決シート（1 件の問題） */
export interface Problem {
  id: string;
  title: string;
  status: ProblemStatus;
  /** いま取り組んでいるステップ（0〜5） */
  step: number;
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
  // ① 問題を定義する
  ideal: string;
  current: string;
  gap: string;
  // ② なぜなぜ分析
  whys: string[];
  rootCause: string;
  // ③④ 打ち手を出して選ぶ
  ideas: Idea[];
  chosenIdeaId: string;
  // ⑤ 行動計画
  actions: Action[];
  // ⑥ ふりかえり
  outcome: Outcome | null;
  result: string;
  learning: string;
  nextTime: string;
}

/** 保存対象のフィールド（id / createdAt を除く） */
export type ProblemData = Omit<Problem, 'id' | 'createdAt'>;

/** 毎日の稽古（お題ドリル） */
export interface Drill {
  id: string;
  prompt: string;
  cause: string;
  ideas: string[];
  /** 稽古した日（ローカル YYYY-MM-DD） */
  dateKey: string;
  createdAt: number;
}
