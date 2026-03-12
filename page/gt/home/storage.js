import { localStorage } from "@zos/storage";

export const STORAGE_KEYS = {
  DEVICE_CODE: "ls_device_code",
  USER_ID: "ls_user_id",
  CURRENT_EXERCISE_ID: "ls_current_exercise_id",
  CURRENT_SET_NUMBER: "ls_current_set_number",
};

const LEGACY_STORAGE_KEYS = {
  device_code: STORAGE_KEYS.DEVICE_CODE,
  user_id: STORAGE_KEYS.USER_ID,
};

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
  ls_remove(STORAGE_KEYS.CURRENT_EXERCISE_ID);
  ls_remove(STORAGE_KEYS.CURRENT_SET_NUMBER);
}

export function clearActiveProgressState() {
  ls_clear_training_state();
}

export function clearTodayWorkoutState() {
  return undefined;
}

export function clearLinkedUserContext() {
  ls_remove(STORAGE_KEYS.USER_ID);
  ls_clear_training_state();
}

export function clearUnlinkedStorage() {
  clearLinkedUserContext();
  ls_remove(STORAGE_KEYS.DEVICE_CODE);
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
