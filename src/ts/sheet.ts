import { button, textEl } from './ui';
import { todayKey } from './dates';
import { MAX_ACTIONS, MAX_IDEAS, MAX_WHYS, newId } from './store';
import { Idea, Problem, Rating } from './types';
import { IDEA_HINTS, OUTCOMES, RATING_LABELS } from './words';

/**
 * 解決シートの各ステップの入力欄を描画する。
 * 入力は draft を直接書き換え、onChange(rerender) で親に通知する。
 * 文字入力では再描画しない（フォーカスを保つため）。追加・削除・選択のときだけ再描画する。
 */
export type ChangeFn = (rerender: boolean) => void;

const RATINGS: Rating[] = [1, 2, 3];

function field(label: string, hint = '', forId = ''): { wrap: HTMLElement; label: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement(forId ? 'label' : 'span');
  l.className = 'field__label';
  l.textContent = label;
  if (forId) (l as HTMLLabelElement).htmlFor = forId;
  if (hint) l.appendChild(textEl('span', 'field__hint', hint));
  wrap.appendChild(l);
  return { wrap, label: l };
}

function textarea(id: string, value: string, placeholder: string, max: number, onInput: (v: string) => void, rows = 3): HTMLTextAreaElement {
  const t = document.createElement('textarea');
  t.id = id;
  t.rows = rows;
  t.maxLength = max;
  t.placeholder = placeholder;
  t.value = value;
  t.addEventListener('input', () => onInput(t.value));
  return t;
}

function input(id: string, value: string, placeholder: string, max: number, onInput: (v: string) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.id = id;
  i.maxLength = max;
  i.placeholder = placeholder;
  i.autocomplete = 'off';
  i.value = value;
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

function choiceRow<K extends string | number>(
  items: { key: K; label: string }[],
  selected: K | null,
  ariaLabel: string,
  onSelect: (key: K) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'choice-group';
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', ariaLabel);
  items.forEach((item) => {
    const b = button(item.label, `choice${item.key === selected ? ' is-selected' : ''}`, () => onSelect(item.key));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(item.key === selected));
    row.appendChild(b);
  });
  return row;
}

function note(text: string, className = 'step-note'): HTMLElement {
  return textEl('p', className, text);
}

export function ideaScore(i: Idea): number | null {
  if (!i.effect || !i.effort) return null;
  return i.effect * 2 - i.effort;
}

// ① 問題を定義する
function renderDefine(d: Problem, onChange: ChangeFn): HTMLElement[] {
  const ideal = field('あるべき姿', 'どうなっていたら理想？', 'f-ideal');
  ideal.wrap.appendChild(textarea('f-ideal', d.ideal, '例：定例会議は30分以内に終わり、決まったことが全員に共有されている', 1000, (v) => { d.ideal = v; onChange(false); }));
  const current = field('現状', '事実・数字で', 'f-current');
  current.wrap.appendChild(textarea('f-current', d.current, '例：会議は平均70分。決定事項があいまいなまま終わる回が週2回ある', 1000, (v) => { d.current = v; onChange(false); }));
  const gap = field('問題を一文でいうと', 'あるべき姿と現状の差', 'f-gap');
  gap.wrap.appendChild(input('f-gap', d.gap, '例：会議が長いのに、決めるべきことが決まらない', 200, (v) => { d.gap = v; onChange(false); }));
  return [ideal.wrap, current.wrap, gap.wrap];
}

// ② なぜなぜ分析
function renderWhys(d: Problem, onChange: ChangeFn): HTMLElement[] {
  const whys = Array.from({ length: MAX_WHYS }, (_, i) => d.whys[i] ?? '');
  const labels: HTMLElement[] = [];
  const subject = (i: number): string => {
    if (i === 0) return d.gap.trim() || d.title;
    return whys[i - 1].trim() || '…';
  };
  const updateLabels = (): void => {
    labels.forEach((l, i) => { l.textContent = `なぜ${i + 1}：なぜ「${subject(i)}」？`; });
  };

  const list = document.createElement('div');
  list.className = 'why-list';
  whys.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'why-list__item';
    const l = document.createElement('label');
    l.className = 'why-list__q';
    l.htmlFor = `f-why-${i}`;
    labels.push(l);
    const inp = input(`f-why-${i}`, w, i === 0 ? '例：議題が決まらないまま始まるから' : 'それはなぜ？', 200, (v) => {
      whys[i] = v;
      d.whys = whys.slice();
      updateLabels();
      onChange(false);
    });
    row.append(l, inp);
    list.appendChild(row);
  });
  updateLabels();

  const root = field('根本原因', '自分たちで手を打てる原因にする', 'f-root');
  const rootInput = textarea('f-root', d.rootCause, '例：会議のゴールを事前に決める習慣がない', 500, (v) => { d.rootCause = v; onChange(false); }, 2);
  const copyBtn = button('いちばん深い「なぜ」の答えを入れる', 'btn btn--ghost btn--sm', () => {
    const last = [...whys].reverse().find((w) => w.trim());
    if (!last) return;
    rootInput.value = last.trim();
    d.rootCause = rootInput.value;
    onChange(false);
  });
  root.wrap.append(rootInput, copyBtn);
  return [list, root.wrap];
}

// ③ 打ち手を出す
function renderIdeas(d: Problem, onChange: ChangeFn): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  if (d.rootCause.trim()) {
    nodes.push(textEl('p', 'step-context', `根本原因：${d.rootCause.trim()}`));
  }
  const hints = document.createElement('div');
  hints.className = 'hint-chips';
  hints.appendChild(textEl('span', 'hint-chips__label', '発想の視点'));
  IDEA_HINTS.forEach((h) => hints.appendChild(textEl('span', 'hint-chips__chip', h)));
  nodes.push(hints);

  const form = document.createElement('div');
  form.className = 'inline-form inline-form--flat';
  const inp = input('f-idea', '', '打ち手を1つ入力して追加', 100, () => undefined);
  inp.setAttribute('aria-label', '打ち手');
  const add = (): void => {
    const text = inp.value.trim();
    if (!text) return;
    if (d.ideas.length >= MAX_IDEAS) return;
    d.ideas = [...d.ideas, { id: newId(), text, effect: 0, effort: 0 }];
    onChange(true);
    window.setTimeout(() => document.getElementById('f-idea')?.focus(), 0);
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      add();
    }
  });
  const addBtn = button('追加', 'btn btn--primary', add);
  addBtn.disabled = d.ideas.length >= MAX_IDEAS;
  form.append(inp, addBtn);
  nodes.push(form);

  const count = d.ideas.length;
  nodes.push(note(count >= 5 ? `${count}個 — いい調子です！` : `${count}個（目標5個）`, 'step-count'));

  const list = document.createElement('ul');
  list.className = 'idea-list';
  d.ideas.forEach((idea) => {
    const li = document.createElement('li');
    li.className = 'idea-list__item';
    li.appendChild(textEl('span', 'idea-list__text', idea.text));
    const del = button('×', 'idea-list__del', () => {
      d.ideas = d.ideas.filter((x) => x.id !== idea.id);
      if (d.chosenIdeaId === idea.id) d.chosenIdeaId = '';
      onChange(true);
    });
    del.setAttribute('aria-label', `「${idea.text}」を削除`);
    li.appendChild(del);
    list.appendChild(li);
  });
  nodes.push(list);
  return nodes;
}

// ④ 評価して選ぶ
function renderChoose(d: Problem, onChange: ChangeFn): HTMLElement[] {
  if (!d.ideas.length) return [note('まだ打ち手がありません。ステップ③で打ち手を出しましょう。', 'step-empty')];
  const scores = d.ideas.map(ideaScore);
  const best = Math.max(...scores.map((s) => (s === null ? -99 : s)));
  const list = document.createElement('div');
  list.className = 'rate-list';
  d.ideas.forEach((idea, idx) => {
    const card = document.createElement('div');
    card.className = `rate-card${d.chosenIdeaId === idea.id ? ' is-chosen' : ''}`;
    const head = document.createElement('div');
    head.className = 'rate-card__head';
    head.appendChild(textEl('span', 'rate-card__text', idea.text));
    if (scores[idx] !== null && scores[idx] === best) head.appendChild(textEl('span', 'rate-card__badge', 'おすすめ'));
    card.appendChild(head);

    const rows = document.createElement('div');
    rows.className = 'rate-card__rows';
    const ratingItems = RATINGS.map((r) => ({ key: r, label: RATING_LABELS[r] }));
    const effRow = document.createElement('div');
    effRow.className = 'rate-card__row';
    effRow.appendChild(textEl('span', 'rate-card__label', '効果'));
    effRow.appendChild(choiceRow(ratingItems, idea.effect || null, '効果', (k) => { idea.effect = k; onChange(true); }));
    const effortRow = document.createElement('div');
    effortRow.className = 'rate-card__row';
    effortRow.appendChild(textEl('span', 'rate-card__label', '手間'));
    effortRow.appendChild(choiceRow(ratingItems, idea.effort || null, '手間', (k) => { idea.effort = k; onChange(true); }));
    rows.append(effRow, effortRow);
    card.appendChild(rows);

    const chooseBtn = button(d.chosenIdeaId === idea.id ? '✓ これでいく' : 'これでいく', `btn btn--sm ${d.chosenIdeaId === idea.id ? 'btn--primary' : 'btn--ghost'}`, () => {
      d.chosenIdeaId = idea.id;
      onChange(true);
    });
    chooseBtn.setAttribute('aria-pressed', String(d.chosenIdeaId === idea.id));
    card.appendChild(chooseBtn);
    list.appendChild(card);
  });
  return [list];
}

// ⑤ 行動計画
function renderPlan(d: Problem, onChange: ChangeFn): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const chosen = d.ideas.find((i) => i.id === d.chosenIdeaId);
  nodes.push(textEl('p', 'step-context', chosen ? `選んだ打ち手：${chosen.text}` : '打ち手がまだ選ばれていません（ステップ④）'));

  const today = todayKey();
  const list = document.createElement('div');
  list.className = 'action-list';
  d.actions.forEach((a, i) => {
    const row = document.createElement('div');
    const overdue = !a.done && !!a.due && a.due < today;
    row.className = `action-row${a.done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'action-row__check';
    check.checked = a.done;
    check.setAttribute('aria-label', '完了');
    check.addEventListener('change', () => { a.done = check.checked; onChange(true); });

    const text = input(`f-action-${i}`, a.text, i === 0 ? '例：次回の議題とゴールをチャットで共有する' : '行動', 100, (v) => { a.text = v; onChange(false); });
    text.className = 'action-row__text';
    text.setAttribute('aria-label', `行動${i + 1}`);

    const due = document.createElement('input');
    due.type = 'date';
    due.className = 'action-row__due';
    due.value = a.due;
    due.setAttribute('aria-label', `行動${i + 1}の期限`);
    due.addEventListener('change', () => { a.due = due.value; onChange(true); });

    const del = button('×', 'action-row__del', () => {
      d.actions = d.actions.filter((x) => x.id !== a.id);
      onChange(true);
    });
    del.setAttribute('aria-label', `行動${i + 1}を削除`);

    row.append(check, text, due, del);
    if (overdue) row.appendChild(textEl('span', 'action-row__flag', '期限切れ'));
    list.appendChild(row);
  });
  nodes.push(list);

  const addBtn = button('＋ 行動を追加', 'btn btn--ghost btn--block', () => {
    d.actions = [...d.actions, { id: newId(), text: '', due: '', done: false }];
    onChange(true);
    window.setTimeout(() => document.getElementById(`f-action-${d.actions.length - 1}`)?.focus(), 0);
  });
  addBtn.disabled = d.actions.length >= MAX_ACTIONS;
  nodes.push(addBtn);
  nodes.push(note('空欄の行動は保存時に取り除かれます。'));
  return nodes;
}

// ⑥ ふりかえり
function renderReflect(d: Problem, onChange: ChangeFn): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const filled = d.actions.filter((a) => a.text.trim());
  if (filled.length) {
    const doneN = filled.filter((a) => a.done).length;
    nodes.push(textEl('p', 'step-context', `行動計画：${filled.length}件中 ${doneN}件 完了`));
  }
  const outcome = field('結果は？');
  outcome.wrap.appendChild(choiceRow(OUTCOMES, d.outcome, '結果', (k) => { d.outcome = k; onChange(true); }));
  const result = field('やってみてどうなった？', '', 'f-result');
  result.wrap.appendChild(textarea('f-result', d.result, '例：会議は平均40分に。ただ、急な議題が入る回は延びがち', 1000, (v) => { d.result = v; onChange(false); }, 2));
  const learning = field('うまくいった理由・いかなかった理由', '必須', 'f-learning');
  learning.wrap.appendChild(textarea('f-learning', d.learning, '例：ゴールが先に共有されると、雑談が自然に減った', 1000, (v) => { d.learning = v; onChange(false); }, 2));
  const next = field('次に活かすこと', '学びの棚に並びます', 'f-next');
  next.wrap.appendChild(input('f-next', d.nextTime, '例：何かを始める前に「何が決まれば終わりか」を書き出す', 200, (v) => { d.nextTime = v; onChange(false); }));
  nodes.push(outcome.wrap, result.wrap, learning.wrap, next.wrap);
  return nodes;
}

const RENDERERS = [renderDefine, renderWhys, renderIdeas, renderChoose, renderPlan, renderReflect];

export function renderStepBody(container: HTMLElement, draft: Problem, step: number, onChange: ChangeFn): void {
  container.replaceChildren(...RENDERERS[step](draft, onChange));
}
