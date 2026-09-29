/* Thin client for the PetroSage FastAPI server (proxied at /api by vite.config.js). */

export async function postQuery(path, query, country = null) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, country }),
    });
  } catch {
    throw new Error('Cannot reach the API server. Is `uvicorn api.server:app --port 8000` running?');
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
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
