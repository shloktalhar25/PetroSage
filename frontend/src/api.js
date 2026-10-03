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

/* POST/DELETE without a request body; resolves to the JSON reply (or null for 204). */
export async function sendRequest(path, method = 'POST') {
  let res;
  try {
    res = await fetch(path, { method });
  } catch {
    throw new Error(UNREACHABLE);
  }
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.status === 204 ? null : res.json();
}

/*
 * Multipart upload with progress (fetch can't report upload progress, XMLHttpRequest can).
 * onProgress receives 0-100; aborting `signal` cancels the upload.
 */
export function uploadFile(path, file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);
    xhr.open('POST', path);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON (e.g. proxy error page) */ }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
      else reject(new Error((body && typeof body.detail === 'string' && body.detail) || `Upload failed (${xhr.status || 'no response'})`));
    };
    xhr.onerror = () => reject(new Error(UNREACHABLE));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' }));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}

/* Same shape as a search answer, so pages can render a failure in the chat. */
export function errorAnswer(err) {
  return {
    paragraphs: [{ text: `Request failed: ${err.message}`, citeIds: [] }],
    sources: [],
    meta: { time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), citations: 0 },
  };
}
