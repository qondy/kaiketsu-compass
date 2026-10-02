import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { isOutcome } from './words';
import { Action, Drill, Idea, Problem, ProblemData, Rating } from './types';

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const msOrNull = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);
const rating = (v: unknown): Rating => (v === 1 || v === 2 || v === 3 ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});

export const MAX_WHYS = 5;
export const MAX_IDEAS = 20;
export const MAX_ACTIONS = 10;

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseIdeas(v: unknown): Idea[] {
  return arr(v).slice(0, MAX_IDEAS).map((x) => {
    const o = obj(x);
    return { id: str(o.id, 40) || newId(), text: str(o.text, 100), effect: rating(o.effect), effort: rating(o.effort) };
  }).filter((i) => i.text);
}

function parseActions(v: unknown): Action[] {
  return arr(v).slice(0, MAX_ACTIONS).map((x) => {
    const o = obj(x);
    const due = str(o.due, 10);
    return {
      id: str(o.id, 40) || newId(),
      text: str(o.text, 100),
      due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '',
      done: o.done === true,
    };
  }).filter((a) => a.text);
}

export function subscribeProblems(
  uid: string,
  onData: (list: Problem[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(collection(db, 'users', uid, 'problems'), (snap) => {
    const list: Problem[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      if (!createdAt || typeof data.title !== 'string') return;
      const step = typeof data.step === 'number' ? Math.min(5, Math.max(0, Math.round(data.step))) : 0;
      list.push({
        id: d.id,
        title: str(data.title, 80),
        status: data.status === 'done' ? 'done' : 'active',
        step,
        createdAt,
        updatedAt: msOrNull(data.updatedAt) ?? createdAt,
        doneAt: msOrNull(data.doneAt),
        ideal: str(data.ideal),
        current: str(data.current),
        gap: str(data.gap),
        whys: arr(data.whys).slice(0, MAX_WHYS).map((w) => str(w, 200)),
        rootCause: str(data.rootCause),
        ideas: parseIdeas(data.ideas),
        chosenIdeaId: str(data.chosenIdeaId, 40),
        actions: parseActions(data.actions),
        outcome: isOutcome(data.outcome) ? data.outcome : null,
        result: str(data.result),
        learning: str(data.learning),
        nextTime: str(data.nextTime),
      });
    });
    onData(list);
  }, onError);
}

export async function createProblem(uid: string, title: string): Promise<string> {
  const now = Date.now();
  const data: ProblemData & { createdAt: number } = {
    title, status: 'active', step: 0, createdAt: now, updatedAt: now, doneAt: null,
    ideal: '', current: '', gap: '', whys: [], rootCause: '',
    ideas: [], chosenIdeaId: '', actions: [],
    outcome: null, result: '', learning: '', nextTime: '',
  };
  const ref = await addDoc(collection(db, 'users', uid, 'problems'), data);
  return ref.id;
}

export function saveProblem(uid: string, id: string, data: ProblemData): Promise<void> {
  return updateDoc(doc(db, 'users', uid, 'problems', id), { ...data, updatedAt: Date.now() });
}

export function deleteProblem(uid: string, id: string): Promise<void> {
  return deleteDoc(doc(db, 'users', uid, 'problems', id));
}

export function subscribeDrills(
  uid: string,
  onData: (list: Drill[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(collection(db, 'users', uid, 'drills'), (snap) => {
    const list: Drill[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const dateKey = str(data.dateKey, 10);
      if (!createdAt || typeof data.prompt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      list.push({
        id: d.id,
        prompt: str(data.prompt, 100),
        cause: str(data.cause, 300),
        ideas: arr(data.ideas).slice(0, 3).map((i) => str(i, 100)).filter(Boolean),
        dateKey,
        createdAt,
      });
    });
    onData(list);
  }, onError);
}

export async function createDrill(uid: string, drill: Omit<Drill, 'id'>): Promise<void> {
  await addDoc(collection(db, 'users', uid, 'drills'), drill);
}

export function deleteDrill(uid: string, id: string): Promise<void> {
  return deleteDoc(doc(db, 'users', uid, 'drills', id));
}
