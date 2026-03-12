import { STORAGE_KEYS, ls_clear_training_state, ls_get, ls_set } from "./storage";

export const UI_STATES = {
  UNLINKED: "unlinked",
  QR: "qr",
  MAIN: "main",
  EXERCISE: "exercise",
  ERROR: "error",
};

export const WEEKDAY_PT_BR = {
  MONDAY: "Segunda-feira",
  TUESDAY: "Terca-feira",
  WEDNESDAY: "Quarta-feira",
  THURSDAY: "Quinta-feira",
  FRIDAY: "Sexta-feira",
  SATURDAY: "Sabado",
  SUNDAY: "Domingo",
};

export function getTodayDateString() {
  const now = new Date();
  return getDateStringFromDate(now);
}

export function getDateStringFromDate(date) {
  const safeDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(safeDate.getTime())) {
    return "";
  }

  const year = safeDate.getFullYear();
  const month = `${safeDate.getMonth() + 1}`.padStart(2, "0");
  const day = `${safeDate.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDateStringFromIso(isoString) {
  if (!isoString) {
    return "";
  }

  return getDateStringFromDate(new Date(isoString));
}

export function isIsoDateToday(isoString) {
  return getDateStringFromIso(isoString) === getTodayDateString();
}

export function generateUuidV4() {
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function sortExercises(exercises) {
  return [...(Array.isArray(exercises) ? exercises : [])].sort((a, b) => {
    const orderA = Number(a?.order || 0);
    const orderB = Number(b?.order || 0);
    return orderA - orderB;
  });
}

export function resolveUserId(payload) {
  const candidates = [
    payload?.userId,
    payload?.user_id,
    payload?.uid,
    payload?.user?.id,
    payload?.user?.userId,
    payload?.account?.id,
    payload?.profile?.id,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim() && value.trim() !== "0") {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return `${value}`;
    }
  }

  return "";
}

export function formatClock(totalSeconds) {
  const safeTotal = Math.max(0, Number(totalSeconds || 0));
  const minutes = `${Math.floor(safeTotal / 60)}`.padStart(2, "0");
  const seconds = `${safeTotal % 60}`.padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function getElapsedSeconds(startedAt, nowMs = Date.now()) {
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : 0;
  if (!startedAtMs || Number.isNaN(startedAtMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

export function resetProgressForSession(exercises = []) {
  const sorted = sortExercises(exercises);
  const firstExerciseId = sorted[0]?.id || "";

  if (firstExerciseId) {
    ls_set(STORAGE_KEYS.CURRENT_EXERCISE_ID, firstExerciseId);
    ls_set(STORAGE_KEYS.CURRENT_SET_NUMBER, 1);
    return;
  }

  ls_clear_training_state();
}

export function buildTrainingState(sessionPayload = {}) {
  const exercises = sortExercises(sessionPayload?.exercises || []);
  const storedExerciseId = ls_get(STORAGE_KEYS.CURRENT_EXERCISE_ID, "").trim();
  const currentExercise =
    exercises.find((exercise) => String(exercise?.id || "") === storedExerciseId) || exercises[0] || null;
  const exerciseIndex = currentExercise
    ? Math.max(
        0,
        exercises.findIndex((exercise) => String(exercise?.id || "") === String(currentExercise?.id || ""))
      )
    : 0;
  const totalSets = Math.max(1, Number(currentExercise?.sets || 1));
  const storedSetNumber = Number(ls_get(STORAGE_KEYS.CURRENT_SET_NUMBER, 1));
  const setNumber = Math.min(Math.max(1, storedSetNumber), totalSets);

  if (currentExercise?.id && String(currentExercise.id) !== storedExerciseId) {
    ls_set(STORAGE_KEYS.CURRENT_EXERCISE_ID, currentExercise.id);
  }

  if (!Number.isFinite(storedSetNumber) || storedSetNumber < 1 || storedSetNumber > totalSets) {
    ls_set(STORAGE_KEYS.CURRENT_SET_NUMBER, setNumber);
  }

  return {
    sessionId: sessionPayload?.sessionId || "",
    startedAt: sessionPayload?.startedAt || "",
    completedAt: sessionPayload?.completedAt || "",
    workout: sessionPayload,
    exercises,
    currentExercise,
    exerciseIndex,
    setsCount: setNumber,
    totalSets,
  };
}

export function getProgressionAction(trainingState) {
  if (!trainingState?.currentExercise) {
    return { type: "none", label: "" };
  }

  const isLastSet = trainingState.setsCount >= trainingState.totalSets;
  const isLastExercise = trainingState.exerciseIndex >= trainingState.exercises.length - 1;

  if (!isLastSet) {
    return { type: "next-set", label: "Proxima Serie" };
  }

  if (!isLastExercise) {
    return { type: "next-exercise", label: "Proxima Serie" };
  }

  return { type: "finish", label: "Finalizar Treino" };
}

export function advanceProgress(trainingState) {
  const action = getProgressionAction(trainingState);

  if (action.type === "next-set") {
    ls_set(STORAGE_KEYS.CURRENT_SET_NUMBER, trainingState.setsCount + 1);
    return action;
  }

  if (action.type === "next-exercise") {
    const nextExercise = trainingState.exercises[trainingState.exerciseIndex + 1] || null;
    if (nextExercise?.id) {
      ls_set(STORAGE_KEYS.CURRENT_EXERCISE_ID, nextExercise.id);
      ls_set(STORAGE_KEYS.CURRENT_SET_NUMBER, 1);
    }
    return action;
  }

  return action;
}
