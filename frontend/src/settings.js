/* User preferences, kept in this browser only (nothing sensitive is stored). */

const STORAGE_KEY = 'petrosage.settings.v1';

/* Jurisdiction label -> country tag stored on indexed chunks (null = search everything). */
export const JURISDICTIONS = {
  All: null,
  India: 'India',
  Norway: 'Norway',
  'United Kingdom': 'UK',
  'United States': 'US',
  'Global (commodity prices)': 'Global',
};

export const TIMEOUT_LIMITS = { min: 10, max: 300 };

export const DEFAULT_SETTINGS = {
  defaultJurisdiction: 'All',
  allowGeneralAnswers: true,
  requestTimeoutSec: 120,
};

/* Field -> error message for every invalid value; empty object when valid. */
export function validateSettings(s) {
  const errors = {};
  if (!(s.defaultJurisdiction in JURISDICTIONS)) {
    errors.defaultJurisdiction = 'Choose one of the listed jurisdictions.';
  }
  if (typeof s.allowGeneralAnswers !== 'boolean') {
    errors.allowGeneralAnswers = 'Must be on or off.';
  }
  const t = Number(s.requestTimeoutSec);
  if (!Number.isInteger(t) || t < TIMEOUT_LIMITS.min || t > TIMEOUT_LIMITS.max) {
    errors.requestTimeoutSec = `Enter a whole number of seconds between ${TIMEOUT_LIMITS.min} and ${TIMEOUT_LIMITS.max}.`;
  }
  return errors;
}

/* Saved settings merged over defaults; any invalid saved field falls back to its default. */
export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { /* storage blocked or corrupt: use defaults */ }
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  for (const field of Object.keys(validateSettings(merged))) merged[field] = DEFAULT_SETTINGS[field];
  return merged;
}

/* Returns true if persisted; throws nothing so callers can show a storage error. */
export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function resetSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
