import { localStorage } from "@zos/storage";

export const STORAGE_KEYS = {
  DEVICE_CODE: "ls_device_code",
  USER_ID: "ls_user_id",
  TODAY_WORKOUT: "ls_today_workout",
  TODAY_EXERCISES: "ls_today_exercises",
  ACTIVE_SESSION_ID: "ls_active_session_id",
  ACTIVE_SESSION_DATE: "ls_active_session_date",
  STARTED_AT: "ls_started_at",
  COMPLETED_AT: "ls_completed_at",
  WORKOUT_PLAN_ID: "ls_workout_plan_id",
  WORKOUT_DAY_ID: "ls_workout_day_id",
  WORKOUT_DAY_NAME: "ls_workout_day_name",
  WEEK_DAY: "ls_week_day",
  IS_REST: "ls_is_rest",
  EXERCISE_INDEX: "ls_exercise_index",
  SETS_COUNT: "ls_sets_count",
  SERIE_COMPLETED: "ls_serie_completed",
  REST_TIME_FULL: "ls_rest_time_full",
  REST_STARTED_AT: "ls_rest_started_at",
  REST_TARGET_AT: "ls_rest_target_at",
  REST_RUNNING: "ls_rest_running",
  ALARM_ID: "ls_alarm_id",
  LAST_UI_STATE: "ls_last_ui_state",
  LAST_ACTIVE_STATUS: "ls_last_active_status",
  LAST_ACTIVE_RESPONSE: "ls_last_active_response",
  LAST_TODAY_RESPONSE: "ls_last_today_response",
  LAST_FINISH_DEBUG: "ls_last_finish_debug",
};

const LEGACY_STORAGE_KEYS = {
  device_code: STORAGE_KEYS.DEVICE_CODE,
  user_id: STORAGE_KEYS.USER_ID,
  today_workout: STORAGE_KEYS.TODAY_WORKOUT,
  today_exercises: STORAGE_KEYS.TODAY_EXERCISES,
  active_session_id: STORAGE_KEYS.ACTIVE_SESSION_ID,
  active_session_date: STORAGE_KEYS.ACTIVE_SESSION_DATE,
  active_session_started_at: STORAGE_KEYS.STARTED_AT,
  last_active_status: STORAGE_KEYS.LAST_ACTIVE_STATUS,
};

const TRAINING_STATE_KEYS = [
  STORAGE_KEYS.ACTIVE_SESSION_ID,
  STORAGE_KEYS.ACTIVE_SESSION_DATE,
  STORAGE_KEYS.STARTED_AT,
  STORAGE_KEYS.WORKOUT_PLAN_ID,
  STORAGE_KEYS.WORKOUT_DAY_ID,
  STORAGE_KEYS.WORKOUT_DAY_NAME,
  STORAGE_KEYS.WEEK_DAY,
  STORAGE_KEYS.IS_REST,
  STORAGE_KEYS.TODAY_WORKOUT,
  STORAGE_KEYS.TODAY_EXERCISES,
  STORAGE_KEYS.EXERCISE_INDEX,
  STORAGE_KEYS.SETS_COUNT,
  STORAGE_KEYS.SERIE_COMPLETED,
  STORAGE_KEYS.REST_TIME_FULL,
  STORAGE_KEYS.REST_STARTED_AT,
  STORAGE_KEYS.REST_TARGET_AT,
  STORAGE_KEYS.REST_RUNNING,
  STORAGE_KEYS.ALARM_ID,
  STORAGE_KEYS.LAST_UI_STATE,
];

const ACTIVE_PROGRESS_KEYS = [
  STORAGE_KEYS.ACTIVE_SESSION_ID,
  STORAGE_KEYS.ACTIVE_SESSION_DATE,
  STORAGE_KEYS.STARTED_AT,
  STORAGE_KEYS.EXERCISE_INDEX,
  STORAGE_KEYS.SETS_COUNT,
  STORAGE_KEYS.SERIE_COMPLETED,
  STORAGE_KEYS.REST_TIME_FULL,
  STORAGE_KEYS.REST_STARTED_AT,
  STORAGE_KEYS.REST_TARGET_AT,
  STORAGE_KEYS.REST_RUNNING,
  STORAGE_KEYS.ALARM_ID,
];

const TODAY_WORKOUT_KEYS = [
  STORAGE_KEYS.TODAY_WORKOUT,
  STORAGE_KEYS.TODAY_EXERCISES,
  STORAGE_KEYS.WORKOUT_PLAN_ID,
  STORAGE_KEYS.WORKOUT_DAY_ID,
  STORAGE_KEYS.WORKOUT_DAY_NAME,
  STORAGE_KEYS.WEEK_DAY,
  STORAGE_KEYS.IS_REST,
];

export function safeParseJson(rawValue, fallback) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return fallback;
  }
}

export function ls_set(key, value) {
  if (value === undefined) {
    localStorage.removeItem(key);
    return;
  }

  if (Array.isArray(value) || (value && typeof value === "object")) {
    localStorage.setItem(key, JSON.stringify(value));
    return;
  }

  if (typeof value === "boolean") {
    localStorage.setItem(key, value ? "true" : "false");
    return;
  }

  localStorage.setItem(key, `${value}`);
}

export function ls_get(key, fallback) {
  const rawValue = localStorage.getItem(key, "");

  if (rawValue === "" || rawValue == null) {
    return fallback;
  }

  if (Array.isArray(fallback) || (fallback && typeof fallback === "object")) {
    return safeParseJson(rawValue, fallback);
  }

  if (typeof fallback === "boolean") {
    return rawValue === true || rawValue === "true" || rawValue === "1";
  }

  if (typeof fallback === "number") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return `${rawValue}`;
}

export function ls_remove(key) {
  localStorage.removeItem(key);
}

export function ls_clear_training_state() {
  TRAINING_STATE_KEYS.forEach((key) => ls_remove(key));
  ls_set(STORAGE_KEYS.REST_RUNNING, false);
}

export function clearActiveProgressState() {
  ACTIVE_PROGRESS_KEYS.forEach((key) => ls_remove(key));
  ls_set(STORAGE_KEYS.REST_RUNNING, false);
}

export function clearTodayWorkoutState() {
  TODAY_WORKOUT_KEYS.forEach((key) => ls_remove(key));
}

export function clearLinkedUserContext() {
  ls_remove(STORAGE_KEYS.USER_ID);
  ls_remove(STORAGE_KEYS.LAST_ACTIVE_STATUS);
  ls_remove(STORAGE_KEYS.LAST_ACTIVE_RESPONSE);
  ls_remove(STORAGE_KEYS.LAST_TODAY_RESPONSE);
  ls_remove(STORAGE_KEYS.COMPLETED_AT);
  ls_clear_training_state();
}

export function clearUnlinkedStorage() {
  clearLinkedUserContext();
  ls_remove(STORAGE_KEYS.DEVICE_CODE);
}

export function getActiveSessionSnapshot() {
  const id = ls_get(STORAGE_KEYS.ACTIVE_SESSION_ID, "").trim();
  const date = ls_get(STORAGE_KEYS.ACTIVE_SESSION_DATE, "").trim();
  return { id, date };
}

export function migrateLegacyStorage() {
  Object.entries(LEGACY_STORAGE_KEYS).forEach(([legacyKey, nextKey]) => {
    const nextValue = localStorage.getItem(nextKey, "");
    const legacyValue = localStorage.getItem(legacyKey, "");

    if ((nextValue === "" || nextValue == null) && legacyValue !== "" && legacyValue != null) {
      localStorage.setItem(nextKey, legacyValue);
    }

    if (legacyValue !== "" && legacyValue != null) {
      localStorage.removeItem(legacyKey);
    }
  });
}
