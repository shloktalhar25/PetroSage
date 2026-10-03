/* Thin client for the PetroSage FastAPI server (proxied at /api by vite.config.js). */
import { loadSettings } from './settings';

const UNREACHABLE = 'Cannot reach the API server. Is `uvicorn api.server:app --port 8000` running?';

async function errorDetail(res) {
  let detail = res.statusText;
  try { detail = (await res.json()).detail || detail; } catch { /* non-JSON error body */ }
  return typeof detail === 'string' ? detail : `Request failed (${res.status})`;
}

export async function postQuery(path, query, country = null) {
  const { requestTimeoutSec, allowGeneralAnswers } = loadSettings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutSec * 1000);
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, country, allow_general: allowGeneralAnswers }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`No answer after ${requestTimeoutSec}s. Try again, or raise the timeout in Settings.`);
    }
    if (!res) throw new Error(UNREACHABLE);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson(path) {
  let res;
  try {
    res = await fetch(path);
  } catch {
    throw new Error(UNREACHABLE);
  }
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

/* Same shape as a search answer, so pages can render a failure in the chat. */
export function errorAnswer(err) {
  return {
    paragraphs: [{ text: `Request failed: ${err.message}`, citeIds: [] }],
    sources: [],
    meta: { time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), citations: 0 },
  };
}
