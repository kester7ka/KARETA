import { getToken } from "./storage.js";

/**
 * База URL API. Пустая строка = тот же origin (127.0.0.1:8000, *.trycloudflare.com).
 * Хост *.trycloudflare.com обрабатывается явно — meta можно не менять при новом quick tunnel.
 * На github.io без URL в meta kareta-api-base запросы уйдут не туда — см. подсказку в app.js.
 */
export function apiBase() {
  if (typeof window === "undefined") {
    return "";
  }
  const w = window.__KARETA_API_BASE__;
  if (w != null && String(w).trim() !== "") {
    return String(w).trim().replace(/\/$/, "");
  }

  const host = window.location.hostname || "";
  // Quick Tunnel: страница и API на одном хосте *.trycloudflare.com — не нужно править meta после смены URL.
  if (host === "trycloudflare.com" || host.endsWith(".trycloudflare.com")) {
    return "";
  }

  let base = "";
  const meta = document.querySelector('meta[name="kareta-api-base"]');
  const c = meta?.getAttribute("content")?.trim();
  if (c) {
    base = c.replace(/\/$/, "");
  }
  return base;
}

function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  const b = apiBase();
  return b ? `${b}${p}` : p;
}

function authHeaders(json = true) {
  const headers = {};
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { detail: await response.text() };

  if (!response.ok) {
    let detail = payload.detail;
    if (Array.isArray(detail)) {
      detail = detail
        .map((item) => (typeof item === "object" && item.msg ? item.msg : String(item)))
        .join(" ");
    } else if (detail && typeof detail === "object") {
      detail = JSON.stringify(detail);
    }
    throw new Error(detail || "Ошибка запроса");
  }
  return payload;
}

export async function sendRegisterCode(data) {
  const response = await fetch(apiUrl("/api/auth/register/send-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse(response);
}

export async function verifyRegister(data) {
  const response = await fetch(apiUrl("/api/auth/register/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse(response);
}

export async function completeRegister(data) {
  const response = await fetch(apiUrl("/api/auth/register/complete"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse(response);
}

export async function sendLoginCode(data) {
  const response = await fetch(apiUrl("/api/auth/login/send-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse(response);
}

export async function verifyLogin(data) {
  const response = await fetch(apiUrl("/api/auth/login/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse(response);
}

export async function sendDeleteCode(data) {
  const response = await fetch(apiUrl("/api/auth/delete/send-code"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return parseResponse(response);
}

export async function confirmDelete(data) {
  const response = await fetch(apiUrl("/api/auth/delete/confirm"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return parseResponse(response);
}

export async function getMe() {
  const response = await fetch(apiUrl("/api/me"), { headers: authHeaders(false) });
  return parseResponse(response);
}

export async function patchProfile(body) {
  const response = await fetch(apiUrl("/api/me"), {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

export async function uploadPublicKey(publicKeySpkiB64) {
  const response = await fetch(apiUrl("/api/me/public-key"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ public_key_spki_b64: publicKeySpkiB64 }),
  });
  return parseResponse(response);
}

export async function searchUsers(q) {
  const params = new URLSearchParams({ q });
  const response = await fetch(apiUrl(`/api/users/search?${params}`), {
    headers: authHeaders(false),
  });
  return parseResponse(response);
}

export async function fetchChats() {
  const response = await fetch(apiUrl("/api/chats"), { headers: authHeaders(false) });
  return parseResponse(response);
}

export async function openChat(peerUsername) {
  const response = await fetch(apiUrl("/api/chats/open"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ peer_username: peerUsername }),
  });
  return parseResponse(response);
}

export async function fetchMessages(conversationId) {
  const response = await fetch(apiUrl(`/api/chats/${conversationId}/messages`), {
    headers: authHeaders(false),
  });
  return parseResponse(response);
}

export async function markChatRead(conversationId) {
  const response = await fetch(apiUrl(`/api/chats/${conversationId}/read`), {
    method: "POST",
    headers: authHeaders(false),
  });
  return parseResponse(response);
}

export async function sendChatMessage(conversationId, payload) {
  const response = await fetch(apiUrl(`/api/chats/${conversationId}/messages`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function fetchPeerProfile(conversationId) {
  const response = await fetch(apiUrl(`/api/chats/${conversationId}/peer-profile`), {
    headers: authHeaders(false),
  });
  return parseResponse(response);
}

export async function sendFriendRequest(conversationId) {
  const response = await fetch(apiUrl(`/api/chats/${conversationId}/friend-request`), {
    method: "POST",
    headers: authHeaders(false),
  });
  return parseResponse(response);
}

export async function acceptFriendRequest(requestId) {
  const response = await fetch(apiUrl(`/api/friend-requests/${requestId}/accept`), {
    method: "POST",
    headers: authHeaders(false),
  });
  return parseResponse(response);
}

export async function fetchContacts() {
  const response = await fetch(apiUrl("/api/contacts"), {
    headers: authHeaders(false),
  });
  return parseResponse(response);
}

export async function logoutSession() {
  const response = await fetch(apiUrl("/api/auth/session"), {
    method: "DELETE",
    headers: authHeaders(false),
  });
  return parseResponse(response);
}
