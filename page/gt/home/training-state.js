import { STORAGE_KEYS, ls_get, ls_remove, ls_set } from "./storage";

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

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export function getRemainingRestSeconds(targetAt, nowMs = Date.now()) {
  const targetAtMs = targetAt ? new Date(targetAt).getTime() : 0;
  if (!targetAtMs || Number.isNaN(targetAtMs)) {
    return 0;
  }

  return Math.max(0, Math.ceil((targetAtMs - nowMs) / 1000));
}

export function clearRestState() {
  ls_remove(STORAGE_KEYS.REST_STARTED_AT);
  ls_remove(STORAGE_KEYS.REST_TARGET_AT);
  ls_remove(STORAGE_KEYS.ALARM_ID);
  ls_set(STORAGE_KEYS.REST_TIME_FULL, 0);
  ls_set(STORAGE_KEYS.REST_RUNNING, false);
}

export function persistWorkoutPayload(payload) {
  const workout = payload || {};
  const exercises = sortExercises(workout?.exercises || []);

  ls_set(STORAGE_KEYS.TODAY_WORKOUT, workout);
  ls_set(STORAGE_KEYS.TODAY_EXERCISES, exercises);
  ls_set(STORAGE_KEYS.WORKOUT_PLAN_ID, workout?.workoutPlanId || "");
  ls_set(STORAGE_KEYS.WORKOUT_DAY_ID, workout?.workoutDayId || "");
  ls_set(STORAGE_KEYS.WORKOUT_DAY_NAME, workout?.workoutDayName || "");
  ls_set(STORAGE_KEYS.WEEK_DAY, workout?.weekDay || "");
  ls_set(STORAGE_KEYS.IS_REST, workout?.isRest === true);
}

export function persistSessionIdentifiers({ sessionId, startedAt, activeDate }) {
  if (sessionId) {
    ls_set(STORAGE_KEYS.ACTIVE_SESSION_ID, sessionId);
  }

  if (startedAt) {
    ls_set(STORAGE_KEYS.STARTED_AT, startedAt);
  }

  if (activeDate) {
    ls_set(STORAGE_KEYS.ACTIVE_SESSION_DATE, activeDate);
  }
}

export function resetProgressForSession() {
  ls_set(STORAGE_KEYS.EXERCISE_INDEX, 0);
  ls_set(STORAGE_KEYS.SETS_COUNT, 1);
  ls_set(STORAGE_KEYS.SERIE_COMPLETED, false);
  clearRestState();
}

export function persistRestState({ restTimeFull, restStartedAt, restTargetAt, alarmId }) {
  ls_set(STORAGE_KEYS.REST_TIME_FULL, Number(restTimeFull || 0));
  ls_set(STORAGE_KEYS.REST_STARTED_AT, restStartedAt || "");
  ls_set(STORAGE_KEYS.REST_TARGET_AT, restTargetAt || "");
  ls_set(STORAGE_KEYS.REST_RUNNING, true);

  if (alarmId) {
    ls_set(STORAGE_KEYS.ALARM_ID, Number(alarmId || 0));
  } else {
    ls_remove(STORAGE_KEYS.ALARM_ID);
  }
}

export function readTrainingState() {
  const exercises = sortExercises(ls_get(STORAGE_KEYS.TODAY_EXERCISES, []));
  const rawExerciseIndex = Number(ls_get(STORAGE_KEYS.EXERCISE_INDEX, 0));
  const maxIndex = Math.max(0, exercises.length - 1);
  const exerciseIndex = Math.min(Math.max(0, rawExerciseIndex), maxIndex);
  const currentExercise = exercises[exerciseIndex] || null;
  const totalSets = Math.max(1, Number(currentExercise?.sets || 1));
  const rawSetsCount = Number(ls_get(STORAGE_KEYS.SETS_COUNT, 1));
  const setsCount = Math.min(Math.max(1, rawSetsCount), totalSets);

  return {
    workout: ls_get(STORAGE_KEYS.TODAY_WORKOUT, {}),
    exercises,
    currentExercise,
    exerciseIndex,
    setsCount,
    totalSets,
    serieCompleted: ls_get(STORAGE_KEYS.SERIE_COMPLETED, false),
    startedAt: ls_get(STORAGE_KEYS.STARTED_AT, ""),
    restRunning: ls_get(STORAGE_KEYS.REST_RUNNING, false),
    restTimeFull: Number(ls_get(STORAGE_KEYS.REST_TIME_FULL, 0)),
    restStartedAt: ls_get(STORAGE_KEYS.REST_STARTED_AT, ""),
    restTargetAt: ls_get(STORAGE_KEYS.REST_TARGET_AT, ""),
    sessionId: ls_get(STORAGE_KEYS.ACTIVE_SESSION_ID, ""),
    sessionDate: ls_get(STORAGE_KEYS.ACTIVE_SESSION_DATE, ""),
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
    return { type: "next-exercise", label: "Proximo Exercicio" };
  }

  return { type: "finish", label: "Finalizar Treino" };
}

export function advanceProgress(trainingState) {
  const action = getProgressionAction(trainingState);

  if (action.type === "next-set") {
    ls_set(STORAGE_KEYS.SETS_COUNT, trainingState.setsCount + 1);
    ls_set(STORAGE_KEYS.SERIE_COMPLETED, false);
    return action;
  }

  if (action.type === "next-exercise") {
    ls_set(STORAGE_KEYS.EXERCISE_INDEX, trainingState.exerciseIndex + 1);
    ls_set(STORAGE_KEYS.SETS_COUNT, 1);
    ls_set(STORAGE_KEYS.SERIE_COMPLETED, false);
    return action;
  }

  return action;
}
