import { clearConversationKeyCache } from "./crypto/e2e.js";

const TOKEN_KEY = "kareta_session_token";
const USER_KEY = "kareta_user";
const CHATS_KEY = "kareta_chats_cache";
const CHAT_PREVIEW_KEY = "kareta_chat_previews";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadSession() {
  return {
    token: getToken(),
    user: safeParse(localStorage.getItem(USER_KEY)),
  };
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearConversationKeyCache();
}

function safeParse(raw) {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getChatsCache() {
  try {
    return JSON.parse(localStorage.getItem(CHATS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function setChatsCache(list) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(list));
}

export function getChatPreviews() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_PREVIEW_KEY) || "{}");
  } catch {
    return {};
  }
}

export function setChatPreview(conversationId, text) {
  const map = getChatPreviews();
  map[String(conversationId)] = text;
  localStorage.setItem(CHAT_PREVIEW_KEY, JSON.stringify(map));
}

/** Объединяет подписи из сервера с локальными превью (для E2EE) и старым кэшем. */
export function mergeChatsWithPreviews(chats) {
  const prevMap = getChatPreviews();
  let oldCache = [];
  try {
    oldCache = JSON.parse(localStorage.getItem(CHATS_KEY) || "[]");
  } catch {
    oldCache = [];
  }
  const oldById = new Map(oldCache.map((x) => [String(x.conversation_id || x.id), x]));
  return (chats || []).map((c) => {
    const id = String(c.conversation_id || c.id);
    const local = prevMap[id];
    const prevSub = oldById.get(id)?.subtitle || "";
    const serverSub = (c.subtitle || "").trim();
    const subtitle = serverSub || local || prevSub || "";
    return { ...c, subtitle };
  });
}
