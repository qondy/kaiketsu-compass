import { User } from 'firebase/auth';
import { onAuthChange, loginWithGoogle, logout } from './auth';
import { showToast, openOverlay, closeOverlay, textEl, button } from './ui';
import { submitFeedback } from './feedback';
import { hashString, labelOf, todayKey } from './dates';
import {
  subscribeProblems, createProblem, saveProblem, deleteProblem,
  subscribeDrills, createDrill, deleteDrill,
} from './store';
import { calcStats, overdueCount, stepComplete } from './stats';
import { renderStepBody } from './sheet';
import { DAILY_WORDS, DRILL_PROMPTS, OUTCOMES, POINTS_PER_SHEET, STEPS } from './words';
import { Drill, Problem, ProblemData } from './types';

// ============================================================
// DOM refs
// ============================================================
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const loginScreen = $('login-screen');
const appEl = $('app');
const userInfo = $('user-info');
const userAvatar = $<HTMLImageElement>('user-avatar');
const userName = $('user-name');
const btnGoogleLogin = $<HTMLButtonElement>('btn-google-login');
const btnLogout = $<HTMLButtonElement>('btn-logout');

const viewHome = $('view-home');
const viewSheet = $('view-sheet');

const dailyWordEl = $('daily-word');
const statPoints = $('stat-points');
const statTitle = $('stat-title');
const statNext = $('stat-next');
const statDone = $('stat-done');
const statSolved = $('stat-solved');
const statDrills = $('stat-drills');
const statStreak = $('stat-streak');
const stepRatesEl = $('step-rates');
const statAdvice = $('stat-advice');

const drillDoneBadge = $('drill-done-badge');
const drillForm = $<HTMLFormElement>('drill-form');
const drillPromptEl = $('drill-prompt');
const btnDrillShuffle = $<HTMLButtonElement>('btn-drill-shuffle');
const inputDrillCause = $<HTMLTextAreaElement>('input-drill-cause');
const inputDrillIdeas = [1, 2, 3].map((n) => $<HTMLInputElement>(`input-drill-idea-${n}`));
const btnDrillSubmit = $<HTMLButtonElement>('btn-drill-submit');
const drillList = $('drill-list');
const drillEmpty = $('drill-empty');
const btnDrillMore = $<HTMLButtonElement>('btn-drill-more');

const problemForm = $<HTMLFormElement>('problem-form');
const inputProblemTitle = $<HTMLInputElement>('input-problem-title');
const btnProblemSubmit = $<HTMLButtonElement>('btn-problem-submit');
const problemTabs = $('problem-tabs');
const countActive = $('count-active');
const countDone = $('count-done');
const problemList = $('problem-list');
const problemEmpty = $('problem-empty');
const shelfList = $('shelf-list');
const shelfEmpty = $('shelf-empty');

const btnSheetBack = $<HTMLButtonElement>('btn-sheet-back');
const btnSheetDelete = $<HTMLButtonElement>('btn-sheet-delete');
const inputSheetTitle = $<HTMLInputElement>('input-sheet-title');
const stepperEl = $('stepper');
const stepNo = $('step-no');
const stepTitle = $('step-title');
const stepGuide = $('step-guide');
const stepBody = $('step-body');
const btnStepPrev = $<HTMLButtonElement>('btn-step-prev');
const btnStepSave = $<HTMLButtonElement>('btn-step-save');
const btnStepNext = $<HTMLButtonElement>('btn-step-next');

const leaveOverlay = $('leave-dialog-overlay');
const btnLeaveDiscard = $<HTMLButtonElement>('btn-leave-discard');
const btnLeaveSave = $<HTMLButtonElement>('btn-leave-save');

const confirmOverlay = $('confirm-dialog-overlay');
const confirmDialogTitle = $('confirm-dialog-title');
const btnConfirmCancel = $<HTMLButtonElement>('btn-confirm-cancel');
const btnConfirmDelete = $<HTMLButtonElement>('btn-confirm-delete');

const feedbackBtn = $<HTMLButtonElement>('feedback-btn');
const feedbackOverlay = $('feedback-modal-overlay');
const inputFeedbackMessage = $<HTMLTextAreaElement>('input-feedback-message');
const btnFeedbackClose = $<HTMLButtonElement>('btn-feedback-close');
const btnFeedbackSend = $<HTMLButtonElement>('btn-feedback-send');

// ============================================================
// State
// ============================================================
type ProblemFilter = 'active' | 'done';

interface State {
  uid: string | null;
  unsubscribers: (() => void)[];
  problems: Problem[];
  drills: Drill[];
  loaded: boolean;
  problemFilter: ProblemFilter;
  drillLimit: number;
  /** 今日のお題からのずらし量（「別のお題」で増える） */
  promptOffset: number;
  /** 編集中のシート（スナップショットで上書きしないよう独立したコピーを持つ） */
  draft: Problem | null;
  viewStep: number;
  dirty: boolean;
  pending: Set<string>;
  confirmAction: (() => Promise<void>) | null;
}

const DRILL_PAGE = 5;

const state: State = {
  uid: null,
  unsubscribers: [],
  problems: [],
  drills: [],
  loaded: false,
  problemFilter: 'active',
  drillLimit: DRILL_PAGE,
  promptOffset: 0,
  draft: null,
  viewStep: 0,
  dirty: false,
  pending: new Set(),
  confirmAction: null,
};

// ============================================================
// Helpers
// ============================================================
/** 同じキーの処理が進行中なら何もしない（二重送信防止） */
async function withLock(key: string, fn: () => Promise<void>, errorMessage = '保存に失敗しました。通信環境を確認してください'): Promise<boolean> {
  if (state.pending.has(key)) return false;
  state.pending.add(key);
  renderBusy();
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    showToast(errorMessage);
    return false;
  } finally {
    state.pending.delete(key);
    renderBusy();
  }
}

function askConfirm(title: string, action: () => Promise<void>): void {
  confirmDialogTitle.textContent = title;
  state.confirmAction = action;
  openOverlay(confirmOverlay);
}

function cloneProblem(p: Problem): Problem {
  return {
    ...p,
    whys: [...p.whys],
    ideas: p.ideas.map((i) => ({ ...i })),
    actions: p.actions.map((a) => ({ ...a })),
  };
}

function todayPrompt(): string {
  const base = hashString(todayKey());
  return DRILL_PROMPTS[(base + state.promptOffset) % DRILL_PROMPTS.length];
}

function stepMark(i: number): string {
  return '①②③④⑤⑥'[i] ?? '';
}

// ============================================================
// Render: home
// ============================================================
function renderBusy(): void {
  btnDrillSubmit.disabled = state.pending.has('drill');
  btnProblemSubmit.disabled = state.pending.has('problem');
  const saving = state.pending.has('sheet');
  btnStepSave.disabled = saving;
  btnStepNext.disabled = saving;
  btnLeaveSave.disabled = saving;
}

function renderDashboard(): void {
  const s = calcStats(state.problems, state.drills);
  dailyWordEl.textContent = DAILY_WORDS[hashString(todayKey()) % DAILY_WORDS.length];
  statPoints.textContent = String(s.points);
  statTitle.textContent = s.title;
  statNext.textContent = s.next ? `「${s.next.name}」まであと${s.next.remain}pt` : '最高の称号に到達！';
  statDone.textContent = String(s.doneSheets);
  statSolved.textContent = String(s.solved);
  statDrills.textContent = String(s.drills);
  statStreak.textContent = String(s.streak);
  drillDoneBadge.classList.toggle('hidden', !s.drilledToday);

  stepRatesEl.replaceChildren(...STEPS.map((step, i) => {
    const rate = s.stepRates[i];
    const row = document.createElement('div');
    row.className = `step-rate${s.weakStep === i ? ' is-weak' : ''}`;
    row.appendChild(textEl('span', 'step-rate__label', `${stepMark(i)} ${step.label}`));
    const track = document.createElement('div');
    track.className = 'step-rate__track';
    const bar = document.createElement('div');
    bar.className = 'step-rate__bar';
    bar.style.width = `${rate ?? 0}%`;
    track.appendChild(bar);
    row.appendChild(track);
    row.appendChild(textEl('span', 'step-rate__num', rate === null ? '—' : `${rate}%`));
    return row;
  }));

  if (s.weakStep !== null) {
    statAdvice.textContent = `コンパスの指す先：次は「${STEPS[s.weakStep].label}」を丁寧に。${STEPS[s.weakStep].guide.split('。')[0]}。`;
  } else if (state.problems.length) {
    statAdvice.textContent = 'どのステップも型どおり。この調子で次の問題へ進みましょう。';
  } else {
    statAdvice.textContent = '解決シートを進めると、ステップごとの充実度がここに表示されます。';
  }
}

function renderDrillForm(): void {
  drillPromptEl.textContent = todayPrompt();
}

function renderDrills(): void {
  const sorted = [...state.drills].sort((a, b) => b.createdAt - a.createdAt);
  const shown = sorted.slice(0, state.drillLimit);
  drillList.replaceChildren(...shown.map((d) => {
    const li = document.createElement('li');
    li.className = 'drill-item card-surface';
    const head = document.createElement('div');
    head.className = 'drill-item__head';
    head.appendChild(textEl('span', 'drill-item__date', labelOf(d.createdAt)));
    const del = button('削除', 'btn btn--ghost btn--sm is-danger', () => {
      const uid = state.uid;
      if (!uid) return;
      askConfirm('この稽古の記録を削除しますか？', () => deleteDrill(uid, d.id));
    });
    head.appendChild(del);
    li.appendChild(head);
    li.appendChild(textEl('p', 'drill-item__prompt', d.prompt));
    if (d.cause) li.appendChild(textEl('p', 'drill-item__cause', `原因：${d.cause}`));
    if (d.ideas.length) {
      const ul = document.createElement('ul');
      ul.className = 'drill-item__ideas';
      d.ideas.forEach((idea) => ul.appendChild(textEl('li', '', idea)));
      li.appendChild(ul);
    }
    return li;
  }));
  drillEmpty.classList.toggle('hidden', state.drills.length > 0 || !state.loaded);
  btnDrillMore.classList.toggle('hidden', sorted.length <= state.drillLimit);
}

function problemCard(p: Problem): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'problem-card card-surface';
  card.addEventListener('click', () => openSheet(p.id));

  const head = document.createElement('div');
  head.className = 'problem-card__head';
  head.appendChild(textEl('span', 'problem-card__title', p.title));
  if (p.status === 'done') {
    const o = OUTCOMES.find((x) => x.key === p.outcome);
    head.appendChild(textEl('span', `outcome-badge outcome-badge--${p.outcome ?? 'none'}`, o ? o.label : '踏破'));
  }
  card.appendChild(head);

  const dots = document.createElement('div');
  dots.className = 'progress-dots';
  STEPS.forEach((_, i) => {
    const dot = document.createElement('span');
    const cls = stepComplete(p, i) ? ' is-complete' : (p.status === 'active' && i === p.step ? ' is-current' : '');
    dot.className = `progress-dots__dot${cls}`;
    dots.appendChild(dot);
  });
  card.appendChild(dots);

  const meta = document.createElement('div');
  meta.className = 'problem-card__meta';
  if (p.status === 'active') {
    meta.appendChild(textEl('span', '', `いまは ${stepMark(p.step)} ${STEPS[p.step].label}`));
    const overdue = overdueCount(p);
    if (overdue) meta.appendChild(textEl('span', 'problem-card__overdue', `期限切れの行動 ${overdue}件`));
  } else if (p.doneAt) {
    meta.appendChild(textEl('span', '', `${labelOf(p.doneAt)} に踏破`));
  }
  card.appendChild(meta);
  return card;
}

function renderProblems(): void {
  const active = state.problems.filter((p) => p.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt);
  const done = state.problems.filter((p) => p.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  countActive.textContent = String(active.length);
  countDone.textContent = String(done.length);
  problemTabs.querySelectorAll<HTMLButtonElement>('.tabs__btn').forEach((b) => {
    const on = b.dataset.filter === state.problemFilter;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  const list = state.problemFilter === 'active' ? active : done;
  problemList.replaceChildren(...list.map(problemCard));
  problemEmpty.textContent = state.problemFilter === 'active'
    ? '進行中のシートはありません。いま気になっている問題を1つ登録してみましょう。'
    : 'まだ踏破したシートはありません。ふりかえりまで進めると、ここに並びます。';
  problemEmpty.classList.toggle('hidden', list.length > 0 || !state.loaded);
}

function renderShelf(): void {
  const items = state.problems
    .filter((p) => p.status === 'done' && (p.nextTime.trim() || p.learning.trim()))
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  shelfList.replaceChildren(...items.map((p) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shelf-item card-surface';
    b.addEventListener('click', () => openSheet(p.id));
    b.appendChild(textEl('p', 'shelf-item__next', p.nextTime.trim() || p.learning.trim()));
    if (p.nextTime.trim() && p.learning.trim()) b.appendChild(textEl('p', 'shelf-item__learning', p.learning.trim()));
    b.appendChild(textEl('p', 'shelf-item__from', `${p.title}${p.doneAt ? `（${labelOf(p.doneAt)}）` : ''}`));
    li.appendChild(b);
    return li;
  }));
  shelfEmpty.classList.toggle('hidden', items.length > 0 || !state.loaded);
}

function renderHome(): void {
  renderDashboard();
  renderDrills();
  renderProblems();
  renderShelf();
  renderBusy();
}

// ============================================================
// Render: sheet editor
// ============================================================
function renderStepper(): void {
  const d = state.draft;
  if (!d) return;
  stepperEl.replaceChildren(...STEPS.map((step, i) => {
    const li = document.createElement('li');
    const cls = [
      'stepper__item',
      i === state.viewStep ? 'is-current' : '',
      stepComplete(d, i) ? 'is-complete' : '',
    ].filter(Boolean).join(' ');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-current', i === state.viewStep ? 'step' : 'false');
    b.appendChild(textEl('span', 'stepper__num', String(i + 1)));
    b.appendChild(textEl('span', 'stepper__label', step.short));
    b.addEventListener('click', () => {
      state.viewStep = i;
      renderSheet();
    });
    li.appendChild(b);
    return li;
  }));
}

function renderSheetNav(): void {
  const d = state.draft;
  if (!d) return;
  btnStepPrev.disabled = state.viewStep === 0;
  if (state.viewStep < STEPS.length - 1) {
    btnStepNext.textContent = '保存して次へ →';
  } else {
    btnStepNext.textContent = d.status === 'done' ? '保存する' : 'ふりかえりを完了して踏破';
  }
  btnStepSave.classList.toggle('hidden', state.viewStep === STEPS.length - 1);
}

function onDraftChange(rerender: boolean): void {
  state.dirty = true;
  if (rerender) renderSheet(false);
  else renderStepper();
}

function renderSheet(scrollTop = true): void {
  const d = state.draft;
  if (!d) return;
  const step = STEPS[state.viewStep];
  stepNo.textContent = `STEP ${state.viewStep + 1} / ${STEPS.length}`;
  stepTitle.textContent = step.label;
  stepGuide.textContent = step.guide;
  renderStepBody(stepBody, d, state.viewStep, onDraftChange);
  renderStepper();
  renderSheetNav();
  renderBusy();
  if (scrollTop) window.scrollTo({ top: 0 });
}

function showView(view: 'home' | 'sheet'): void {
  viewHome.classList.toggle('hidden', view !== 'home');
  viewSheet.classList.toggle('hidden', view !== 'sheet');
  window.scrollTo({ top: 0 });
}

function openSheet(id: string): void {
  const p = state.problems.find((x) => x.id === id);
  if (!p) return;
  state.draft = cloneProblem(p);
  state.viewStep = p.status === 'done' ? STEPS.length - 1 : p.step;
  state.dirty = false;
  inputSheetTitle.value = p.title;
  showView('sheet');
  renderSheet();
}

function closeSheet(): void {
  state.draft = null;
  state.dirty = false;
  showView('home');
  renderHome();
}

/** draft を保存用データに整える（空欄の行動・打ち手を除く） */
function toData(d: Problem, step: number): ProblemData {
  const ideas = d.ideas.filter((i) => i.text.trim());
  return {
    title: d.title.trim() || '無題の問題',
    status: d.status,
    step,
    updatedAt: Date.now(),
    doneAt: d.doneAt,
    ideal: d.ideal.trim(),
    current: d.current.trim(),
    gap: d.gap.trim(),
    whys: d.whys.map((w) => w.trim()),
    rootCause: d.rootCause.trim(),
    ideas,
    chosenIdeaId: ideas.some((i) => i.id === d.chosenIdeaId) ? d.chosenIdeaId : '',
    actions: d.actions.map((a) => ({ ...a, text: a.text.trim() })).filter((a) => a.text),
    outcome: d.outcome,
    result: d.result.trim(),
    learning: d.learning.trim(),
    nextTime: d.nextTime.trim(),
  };
}

async function saveDraft(nextStep: number, extra: Partial<Problem> = {}): Promise<boolean> {
  const uid = state.uid;
  const d = state.draft;
  if (!uid || !d) return false;
  Object.assign(d, extra);
  // 進行中のシートは、到達したいちばん先のステップを記録する
  const step = d.status === 'done' ? d.step : Math.max(d.step, nextStep);
  const data = toData(d, step);
  const ok = await withLock('sheet', () => saveProblem(uid, d.id, data));
  if (ok && state.draft && state.draft.id === d.id) {
    state.draft = cloneProblem({ ...d, ...data });
    state.dirty = false;
  }
  return ok;
}

// ============================================================
// Auth
// ============================================================
function onLoadError(err: Error): void {
  console.error(err);
  showToast('データの読み込みに失敗しました。再読み込みしてください');
}

function handleUser(user: User | null): void {
  state.unsubscribers.forEach((fn) => fn());
  state.unsubscribers = [];
  state.problems = [];
  state.drills = [];
  state.loaded = false;
  state.uid = user?.uid ?? null;
  state.draft = null;
  state.dirty = false;
  showView('home');

  if (!user) {
    loginScreen.classList.remove('hidden');
    appEl.classList.add('hidden');
    userInfo.classList.add('hidden');
    return;
  }

  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  userInfo.classList.remove('hidden');
  userName.textContent = user.displayName ?? '';
  if (user.photoURL) {
    userAvatar.src = user.photoURL;
    userAvatar.classList.remove('hidden');
  } else {
    userAvatar.classList.add('hidden');
  }

  renderDrillForm();
  renderHome();
  let gotProblems = false;
  let gotDrills = false;
  const markLoaded = (): void => { state.loaded = gotProblems && gotDrills; };
  state.unsubscribers.push(
    subscribeProblems(user.uid, (list) => {
      state.problems = list;
      gotProblems = true;
      markLoaded();
      renderHome();
    }, onLoadError),
    subscribeDrills(user.uid, (list) => {
      state.drills = list;
      gotDrills = true;
      markLoaded();
      renderHome();
    }, onLoadError),
  );
}

// ============================================================
// Events: auth
// ============================================================
btnGoogleLogin.addEventListener('click', async () => {
  btnGoogleLogin.disabled = true;
  try {
    await loginWithGoogle();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      console.error(err);
      showToast('ログインに失敗しました');
    }
  } finally {
    btnGoogleLogin.disabled = false;
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await logout();
  } catch (err) {
    console.error(err);
    showToast('ログアウトに失敗しました');
  }
});

// ============================================================
// Events: drill
// ============================================================
btnDrillShuffle.addEventListener('click', () => {
  state.promptOffset += 1;
  renderDrillForm();
});

drillForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const cause = inputDrillCause.value.trim().slice(0, 300);
  const ideas = inputDrillIdeas.map((i) => i.value.trim().slice(0, 100)).filter(Boolean);
  if (!cause) {
    showToast('原因を書いてみましょう');
    inputDrillCause.focus();
    return;
  }
  if (!ideas.length) {
    showToast('打ち手を1つ以上書いてみましょう');
    inputDrillIdeas[0].focus();
    return;
  }
  const prompt = todayPrompt();
  void withLock('drill', async () => {
    await createDrill(uid, { prompt, cause, ideas, dateKey: todayKey(), createdAt: Date.now() });
    inputDrillCause.value = '';
    inputDrillIdeas.forEach((i) => { i.value = ''; });
    state.promptOffset += 1;
    renderDrillForm();
    showToast('稽古おつかれさま！ +2pt');
  });
});

btnDrillMore.addEventListener('click', () => {
  state.drillLimit += DRILL_PAGE;
  renderDrills();
});

// ============================================================
// Events: problems
// ============================================================
problemForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const title = inputProblemTitle.value.trim().slice(0, 80);
  if (!title) {
    showToast('取り組む問題を入力してください');
    inputProblemTitle.focus();
    return;
  }
  void withLock('problem', async () => {
    const id = await createProblem(uid, title);
    inputProblemTitle.value = '';
    state.problemFilter = 'active';
    // スナップショット反映後にシートを開く
    const tryOpen = (n: number): void => {
      if (state.problems.some((p) => p.id === id)) openSheet(id);
      else if (n > 0) window.setTimeout(() => tryOpen(n - 1), 100);
    };
    tryOpen(20);
  });
});

problemTabs.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.tabs__btn');
  const filter = btn?.dataset.filter;
  if (filter !== 'active' && filter !== 'done') return;
  state.problemFilter = filter;
  renderProblems();
});

// ============================================================
// Events: sheet editor
// ============================================================
inputSheetTitle.addEventListener('input', () => {
  if (!state.draft) return;
  state.draft.title = inputSheetTitle.value;
  state.dirty = true;
});

btnSheetBack.addEventListener('click', () => {
  if (state.dirty) openOverlay(leaveOverlay);
  else closeSheet();
});

btnLeaveDiscard.addEventListener('click', () => {
  closeOverlay(leaveOverlay);
  closeSheet();
});

btnLeaveSave.addEventListener('click', async () => {
  if (!state.draft) return;
  if (await saveDraft(state.viewStep)) {
    closeOverlay(leaveOverlay);
    closeSheet();
    showToast('保存しました');
  }
});

btnSheetDelete.addEventListener('click', () => {
  const uid = state.uid;
  const d = state.draft;
  if (!uid || !d) return;
  askConfirm('この解決シートを削除しますか？', async () => {
    await deleteProblem(uid, d.id);
    closeSheet();
    showToast('削除しました');
  });
});

btnStepPrev.addEventListener('click', () => {
  if (state.viewStep === 0) return;
  state.viewStep -= 1;
  renderSheet();
});

btnStepSave.addEventListener('click', async () => {
  if (await saveDraft(state.viewStep)) {
    showToast('保存しました');
    renderSheet(false);
  }
});

btnStepNext.addEventListener('click', async () => {
  const d = state.draft;
  if (!d) return;
  const last = state.viewStep === STEPS.length - 1;
  if (!last) {
    if (await saveDraft(state.viewStep + 1)) {
      state.viewStep += 1;
      renderSheet();
    }
    return;
  }
  if (!d.outcome) {
    showToast('結果を選んでください');
    return;
  }
  if (!d.learning.trim()) {
    showToast('うまくいった理由・いかなかった理由を書きましょう');
    document.getElementById('f-learning')?.focus();
    return;
  }
  const wasDone = d.status === 'done';
  const extra: Partial<Problem> = wasDone ? {} : { status: 'done', doneAt: Date.now() };
  if (await saveDraft(state.viewStep, extra)) {
    closeSheet();
    showToast(wasDone ? '保存しました' : `踏破おめでとう！ +${POINTS_PER_SHEET}pt`);
  } else if (!wasDone && state.draft) {
    // 保存に失敗したら完了状態を戻す
    state.draft.status = 'active';
    state.draft.doneAt = null;
  }
});

// ============================================================
// Events: dialogs / feedback
// ============================================================
btnConfirmCancel.addEventListener('click', () => {
  state.confirmAction = null;
  closeOverlay(confirmOverlay);
});

btnConfirmDelete.addEventListener('click', async () => {
  const action = state.confirmAction;
  if (!action) return;
  btnConfirmDelete.disabled = true;
  try {
    state.confirmAction = null;
    closeOverlay(confirmOverlay);
    await action();
  } catch (err) {
    console.error(err);
    showToast('削除に失敗しました');
  } finally {
    btnConfirmDelete.disabled = false;
  }
});

feedbackBtn.addEventListener('click', () => {
  openOverlay(feedbackOverlay);
  inputFeedbackMessage.focus();
});

btnFeedbackClose.addEventListener('click', () => closeOverlay(feedbackOverlay));

btnFeedbackSend.addEventListener('click', async () => {
  const message = inputFeedbackMessage.value.trim();
  if (!message) {
    showToast('内容を入力してください');
    return;
  }
  if (btnFeedbackSend.disabled) return;
  btnFeedbackSend.disabled = true;
  const ok = await submitFeedback(message);
  btnFeedbackSend.disabled = false;
  if (ok) {
    inputFeedbackMessage.value = '';
    closeOverlay(feedbackOverlay);
    showToast('送信しました。ありがとうございます！');
  } else {
    showToast('送信に失敗しました。時間をおいてお試しください');
  }
});

// オーバーレイの背景クリック / Escで閉じる
const overlays = [leaveOverlay, feedbackOverlay, confirmOverlay];

function closeAllOverlays(target?: HTMLElement): void {
  (target ? [target] : overlays).forEach((o) => {
    closeOverlay(o);
    if (o === confirmOverlay) state.confirmAction = null;
  });
}

overlays.forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAllOverlays(overlay);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllOverlays();
});

// 保存していない入力があるままページを離れようとしたら警告する
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 日付が変わったら「今日のお題」「ひとこと」を更新する
let lastDay = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.uid) return;
  if (todayKey() !== lastDay) {
    lastDay = todayKey();
    state.promptOffset = 0;
    renderDrillForm();
  }
  if (!state.draft) renderHome();
});

onAuthChange(handleUser);
