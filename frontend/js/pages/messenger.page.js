import {
  acceptFriendRequest,
  confirmDelete,
  fetchChats,
  fetchContacts,
  fetchMessages,
  fetchPeerProfile,
  getMe,
  markChatRead,
  logoutSession,
  openChat,
  patchProfile,
  searchUsers,
  sendFriendRequest,
  sendChatMessage,
  sendDeleteCode,
  uploadPublicKey,
} from "../api.js";
import {
  decryptChatMessage,
  encryptChatMessage,
  ensureE2EKeys,
  getConversationAesKey,
} from "../crypto/e2e.js";
import { refreshIcons } from "../icons.js";
import {
  clearSession,
  getChatsCache,
  getToken,
  mergeChatsWithPreviews,
  saveSession,
  setChatPreview,
  setChatsCache,
} from "../storage.js";

const TITLES = {
  contacts: "Контакты",
  chats: "Чаты",
  calls: "Звонки",
  profile: "Профиль",
};

const PROFILE_DETAIL_TITLES = {
  about: "О себе",
  privacy: "Приватность",
  contact: "Связь",
  account: "Аккаунт",
};

const SECTION_ORDER = { contacts: 0, chats: 1, calls: 2, profile: 3 };

function wrapTabContent(html, { animateTab, tabDir } = {}) {
  if (animateTab) {
    const cls = tabDir === "prev" ? "ms-tab-panel--in-prev" : "ms-tab-panel--in-next";
    return `<div class="ms-tab-panel ${cls}">${html}</div>`;
  }
  return `<div class="ms-tab-panel ms-tab-panel--static">${html}</div>`;
}

function forceDigits(input, maxLength = 6) {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, maxLength);
  });
}

function setMessage(node, text, type = "") {
  node.textContent = text;
  node.className = `auth-msg ${type}`.trim();
}

function safeAvatarSrc(src) {
  if (!src || typeof src !== "string") {
    return "";
  }
  if (src.startsWith("data:image/")) {
    return src.replace(/"/g, "&quot;");
  }
  return "";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function avatarColorSeed(input) {
  const src = String(input || "u");
  let hash = 0;
  for (let i = 0; i < src.length; i += 1) {
    hash = (hash * 31 + src.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 70% 46%)`;
}

function mapServerChatsToCache(serverChats) {
  return (serverChats || []).map((c) => ({
    id: c.id,
    conversation_id: c.id,
    title: c.peer?.username || "Чат",
    subtitle: c.last_message || "",
    peer: c.peer,
    updated_at: c.updated_at,
  }));
}

function privacyFromUser(u) {
  const av = u.privacy_avatar || (u.show_avatar_non_contacts !== false ? "everyone" : "contacts");
  const nm = u.privacy_name || (u.show_name_non_contacts !== false ? "everyone" : "contacts");
  return { avatar: av, name: nm };
}

function truncatePreview(text, max = 72) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

function rememberLastMessagePreview(conversationId, plainText) {
  const t = truncatePreview(plainText, 120);
  if (!t) {
    return;
  }
  setChatPreview(conversationId, t);
  const list = getChatsCache();
  const next = list.map((x) =>
    (x.conversation_id || x.id) === conversationId ? { ...x, subtitle: truncatePreview(t) } : x,
  );
  setChatsCache(next);
}

export function renderMessengerScreen(container, { user, onBackToAuth }) {
  let currentUser = { ...user };
  let section = "chats";
  let profileTab = "about";
  let profileMenuMode = true;
  let thread = null;
  let pollTimer = null;
  let lastChatsNotifySig = null;

  function closeModal() {
    const el = container.querySelector("#ms-modal-overlay");
    if (el) {
      el.classList.add("hidden");
      el.setAttribute("aria-hidden", "true");
    }
  }

  function openModal(html) {
    const overlay = container.querySelector("#ms-modal-overlay");
    const body = container.querySelector("#ms-modal-body");
    if (!overlay || !body) {
      return;
    }
    body.innerHTML = html;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    refreshIcons();
  }

  function openPeerProfileModal() {
    if (!thread) {
      return;
    }
    (async () => {
      try {
        const res = await fetchPeerProfile(thread.conversationId);
        const p = res.peer;
        const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
        const letter = escapeHtml((p.username || "?").replace(/^@/, "").slice(0, 1).toUpperCase() || "?");
        const avHtml = safeAvatarSrc(p.avatar)
          ? `<img src="${safeAvatarSrc(p.avatar)}" alt="" />`
          : `<div class="ms-modal-av-placeholder" style="background:${avatarColorSeed(p.username)}">${letter}</div>`;
        const contactBtn =
          !p.is_contact &&
          `<button type="button" class="btn btn-secondary btn-wide" id="ms-modal-friend">Добавить в контакты</button>`;
        openModal(`
      <div class="ms-modal-profile">
        <div class="ms-modal-av">${avHtml}</div>
        <h2 class="ms-modal-name">${escapeHtml(p.username || "")}</h2>
        ${
          name
            ? `<p class="ms-modal-sub">${escapeHtml(name)}</p>`
            : '<p class="ms-modal-sub ms-muted">Имя недоступно</p>'
        }
        <div class="ms-modal-rows">
          <div class="ms-modal-row"><i data-lucide="align-left"></i><span>${escapeHtml(p.bio || "—")}</span></div>
          <div class="ms-modal-row"><i data-lucide="mail"></i><span>${escapeHtml(p.email || "—")}</span></div>
          <div class="ms-modal-row"><i data-lucide="smartphone"></i><span>${escapeHtml(p.phone || "—")}</span></div>
        </div>
        ${contactBtn || '<p class="ms-modal-hint">Вы в контактах</p>'}
      </div>
    `);
        const btn = container.querySelector("#ms-modal-friend");
        if (btn) {
          btn.addEventListener("click", async () => {
            try {
              const out = await sendFriendRequest(thread.conversationId);
              alert(out.message || "Запрос отправлен.");
              closeModal();
            } catch (e) {
              alert(e.message);
            }
          });
        }
      } catch (e) {
        alert(e.message);
      }
    })();
  }

  function setRefreshing(on) {
    const btn = container.querySelector("#ms-refresh");
    const line = container.querySelector("#ms-progress");
    if (btn) {
      btn.classList.toggle("spinning", on);
    }
    if (line) {
      line.classList.toggle("active", on);
    }
  }

  function updateOfflineBanner() {
    const el = container.querySelector("#ms-offline");
    if (!el) {
      return;
    }
    el.hidden = navigator.onLine;
    if (!navigator.onLine) {
      setRefreshing(true);
    }
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function mountShell() {
    container.innerHTML = `
      <div class="ms-shell" id="ms-shell">
        <header class="ms-top">
          <div class="ms-top-row">
            <button type="button" class="ms-btn-icon hidden" id="ms-back" title="Назад">
              <i data-lucide="arrow-left"></i>
            </button>
            <h1 class="ms-title" id="ms-title">${TITLES.chats}</h1>
            <button type="button" class="ms-btn-icon" id="ms-refresh" title="Обновить">
              <i data-lucide="refresh-cw"></i>
            </button>
          </div>
          <div class="ms-progress" id="ms-progress"></div>
          <div class="ms-offline" id="ms-offline" hidden>Нет сети — показаны сохранённые чаты.</div>
        </header>
        <div class="ms-body" id="ms-body"></div>
        <nav class="ms-nav" id="ms-nav">
          <button type="button" data-section="contacts"><i data-lucide="users"></i>Контакты</button>
          <button type="button" class="active" data-section="chats"><i data-lucide="messages-square"></i>Чаты</button>
          <button type="button" data-section="calls"><i data-lucide="phone"></i>Звонки</button>
          <button type="button" data-section="profile"><i data-lucide="user"></i>Профиль</button>
        </nav>
        <div id="ms-modal-overlay" class="ms-modal-overlay hidden" aria-hidden="true">
          <div class="ms-modal" role="document">
            <button type="button" class="ms-modal-close" id="ms-modal-close" title="Закрыть"><i data-lucide="x"></i></button>
            <div id="ms-modal-body" class="ms-modal-body"></div>
          </div>
        </div>
      </div>
    `;
    refreshIcons();

    const modalOverlay = container.querySelector("#ms-modal-overlay");
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) {
        closeModal();
      }
    });
    container.querySelector("#ms-modal-close").addEventListener("click", () => closeModal());

    container.querySelector("#ms-refresh").addEventListener("click", () => {
      syncFromServer();
    });

    container.querySelector("#ms-back").addEventListener("click", () => {
      closeThread();
    });

    container.querySelector("#ms-nav").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-section]");
      if (!btn || thread) {
        return;
      }
      const from = section;
      section = btn.dataset.section;
      if (section === "profile") {
        profileMenuMode = true;
      }
      const orderDiff = SECTION_ORDER[section] - SECTION_ORDER[from];
      const tabDir = orderDiff >= 0 ? "next" : "prev";
      container.querySelectorAll("#ms-nav button").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      container.querySelector("#ms-title").textContent = TITLES[section] || "KARETA";
      renderBody({ animateTab: true, tabDir });
    });

    const EDGE_PX = 32;
    const SWIPE_MIN_DX = 64;
    let edgeSwipe = null;
    const shell = container.querySelector("#ms-shell");
    shell.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) {
          edgeSwipe = null;
          return;
        }
        const t = e.touches[0];
        if (t.clientX > EDGE_PX) {
          edgeSwipe = null;
          return;
        }
        edgeSwipe = { x: t.clientX, y: t.clientY };
      },
      { passive: true },
    );
    shell.addEventListener(
      "touchend",
      (e) => {
        if (!edgeSwipe || !e.changedTouches.length) {
          return;
        }
        const t = e.changedTouches[0];
        const dx = t.clientX - edgeSwipe.x;
        const dy = Math.abs(t.clientY - edgeSwipe.y);
        edgeSwipe = null;
        if (dy > 110) {
          return;
        }
        if (dx < SWIPE_MIN_DX) {
          return;
        }
        if (thread) {
          closeThread();
          return;
        }
        if (section === "profile" && !profileMenuMode) {
          profileMenuMode = true;
          renderBody();
        }
      },
      { passive: true },
    );
  }

  function chatsNotifySignature(chats) {
    if (!chats || !chats.length) {
      return "";
    }
    return chats
      .map((c) => `${c.id}|${c.updated_at || ""}|${String(c.last_message || "").slice(0, 160)}`)
      .join("¦");
  }

  async function syncFromServer() {
    updateOfflineBanner();
    if (!navigator.onLine) {
      return;
    }
    setRefreshing(true);
    try {
      const [chatsRes, meRes] = await Promise.all([fetchChats(), getMe()]);
      currentUser = meRes.user;
      saveSession(getToken(), currentUser);
      const mapped = mapServerChatsToCache(chatsRes.chats);
      if (mapped.length) {
        setChatsCache(mergeChatsWithPreviews(mapped));
      }
      const sig = chatsNotifySignature(chatsRes.chats);
      if (
        lastChatsNotifySig !== null &&
        sig !== lastChatsNotifySig &&
        document.hidden &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        !thread
      ) {
        try {
          new Notification("KARETA", {
            body: "Новое сообщение или обновление в чатах.",
            tag: "kareta-chats",
          });
        } catch {
          /* iOS / встроенные браузеры часто блокируют */
        }
      }
      lastChatsNotifySig = sig;
    } catch {
      /* keep cache */
    } finally {
      if (navigator.onLine) {
        setRefreshing(false);
      }
      updateOfflineBanner();
      renderBody();
    }
  }

  function closeThread() {
    stopPoll();
    thread = null;
    const bodyEl = container.querySelector("#ms-body");
    if (bodyEl) {
      bodyEl.classList.remove("ms-body--thread");
    }
    container.querySelector("#ms-back").classList.add("hidden");
    container.querySelector("#ms-nav").classList.remove("hidden");
    container.querySelector("#ms-title").textContent = TITLES[section] || TITLES.chats;
    renderBody();
  }

  async function openThread(conversationId, peer) {
    thread = { conversationId, peer };
    stopPoll();
    container.querySelector("#ms-back").classList.remove("hidden");
    container.querySelector("#ms-nav").classList.add("hidden");
    container.querySelector("#ms-title").textContent = peer.username || "Чат";
    await renderThread();

    async function load() {
      if (!navigator.onLine) {
        return;
      }
      try {
        const res = await fetchMessages(conversationId);
        renderIncomingRequest(res.incoming_request);
        await renderMessages(res.messages || []);
        try {
          await markChatRead(conversationId);
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    }

    await load();
    pollTimer = setInterval(() => {
      load();
    }, 4000);

    window.addEventListener("online", load);
  }

  function renderIncomingRequest(request) {
    const host = container.querySelector("#ms-request-host");
    if (!host) {
      return;
    }
    if (!request) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = `
      <div class="ms-friend-request">
        <div>Запрос в контакты от ${escapeHtml(thread?.peer?.username || "пользователя")}</div>
        <button type="button" class="ms-mini" id="ms-accept-request">Принять</button>
      </div>
    `;
    host.querySelector("#ms-accept-request").addEventListener("click", async () => {
      try {
        await acceptFriendRequest(request.id);
        host.innerHTML = `<div class="ms-friend-request ok">Запрос принят. Пользователь добавлен в контакты.</div>`;
        syncFromServer();
      } catch (e) {
        alert(e.message);
      }
    });
  }

  async function renderMessages(messages) {
    const box = container.querySelector("#ms-msgs");
    if (!box) {
      return;
    }
    if (!messages.length) {
      box.innerHTML = `<div class="ms-empty">Нет сообщений. Напиши первым.</div>`;
      refreshIcons();
      return;
    }
    if (!thread.peer.public_key_spki) {
      box.innerHTML = `<div class="ms-empty">У собеседника нет ключа шифрования — сообщения недоступны.</div>`;
      refreshIcons();
      return;
    }
    let aesKey;
    try {
      aesKey = await getConversationAesKey(thread.conversationId, thread.peer.public_key_spki);
    } catch (e) {
      box.innerHTML = `<div class="ms-empty">${escapeHtml(e.message)}</div>`;
      refreshIcons();
      return;
    }
    const lines = await Promise.all(
      messages.map(async (m) => {
        let text = "";
        if (m.is_encrypted && m.iv_b64 && m.ciphertext_b64) {
          try {
            text = await decryptChatMessage(aesKey, m.iv_b64, m.ciphertext_b64);
          } catch {
            text = "· не удалось расшифровать ·";
          }
        } else {
          text = m.body || "";
        }
        const tick =
          m.mine &&
          `<span class="ms-msg-ticks" title="${m.read_by_peer ? "Прочитано" : "Отправлено"}">${
            m.read_by_peer
              ? '<span class="ms-ticks-double"><i data-lucide="check"></i><i data-lucide="check"></i></span>'
              : '<i data-lucide="check"></i>'
          }</span>`;
        const metaLine = m.mine
          ? `<span class="ms-bubble-time">${escapeHtml(formatTime(m.created_at))}</span>${tick || ""}`
          : `${escapeHtml(m.sender_username)} · ${escapeHtml(formatTime(m.created_at))}`;
        return `
      <div class="ms-bubble ${m.mine ? "me" : "them"}">
        ${escapeHtml(text)}
        <div class="ms-bubble-meta">${metaLine}</div>
      </div>`;
      }),
    );
    box.innerHTML = lines.join("");
    const last = messages.length ? messages[messages.length - 1] : null;
    if (last) {
      let lastText = "";
      if (last.is_encrypted && last.iv_b64 && last.ciphertext_b64) {
        try {
          lastText = await decryptChatMessage(aesKey, last.iv_b64, last.ciphertext_b64);
        } catch {
          lastText = "";
        }
      } else {
        lastText = last.body || "";
      }
      if (lastText) {
        rememberLastMessagePreview(thread.conversationId, lastText);
      }
    }
    refreshIcons();
    box.scrollTop = box.scrollHeight;
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    } catch {
      return "";
    }
  }

  async function renderThread() {
    const body = container.querySelector("#ms-body");
    body.classList.add("ms-body--thread");
    const canEncrypt = Boolean(thread.peer.public_key_spki);
    body.innerHTML = `
      <div class="ms-thread">
        <div id="ms-request-host"></div>
        <div class="ms-thread-peer">
          <div>
            <div class="ms-chat-title">${escapeHtml(thread.peer.username || "Профиль")}</div>
            <div class="ms-chat-sub">Открыть профиль и отправить запрос в контакты</div>
          </div>
          <button type="button" class="ms-mini" id="ms-open-peer-profile">Профиль</button>
        </div>
        ${
          !canEncrypt
            ? `<div class="ms-offline">Собеседник не опубликовал ключ шифрования — отправка недоступна.</div>`
            : ""
        }
        <div class="ms-msgs" id="ms-msgs"></div>
        <div class="ms-compose">
          <textarea id="ms-input" rows="1" placeholder="Сообщение…" ${canEncrypt ? "" : "disabled"}></textarea>
          <button type="button" id="ms-send" title="Отправить" ${canEncrypt ? "" : "disabled"}><i data-lucide="send"></i></button>
        </div>
      </div>
    `;
    refreshIcons();
    body.querySelector("#ms-open-peer-profile").addEventListener("click", () => {
      openPeerProfileModal();
    });

    const ta = body.querySelector("#ms-input");
    const send = async () => {
      const text = ta.value.trim();
      if (!text || !navigator.onLine || !canEncrypt) {
        return;
      }
      try {
        const aesKey = await getConversationAesKey(thread.conversationId, thread.peer.public_key_spki);
        const encrypted = await encryptChatMessage(aesKey, text);
        await sendChatMessage(thread.conversationId, encrypted);
        rememberLastMessagePreview(thread.conversationId, text);
        ta.value = "";
        const res = await fetchMessages(thread.conversationId);
        await renderMessages(res.messages || []);
        syncFromServer();
      } catch (e) {
        alert(e.message);
      }
    };
    body.querySelector("#ms-send").addEventListener("click", send);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  }

  function renderBody(opts = {}) {
    if (thread) {
      return;
    }
    const body = container.querySelector("#ms-body");
    if (!body) {
      return;
    }
    const tabOpts = { animateTab: opts.animateTab === true, tabDir: opts.tabDir || "next" };
    if (section === "contacts") {
      renderContacts(body, tabOpts);
      return;
    }
    if (section === "calls") {
      body.innerHTML = wrapTabContent(
        `
        <div class="ms-empty">
          <i data-lucide="phone-missed"></i>
          <p>Звонки скоро.</p>
        </div>`,
        tabOpts,
      );
      refreshIcons();
      return;
    }
    if (section === "profile") {
      renderProfile(body, tabOpts);
      return;
    }
    renderChats(body, tabOpts);
  }

  function mergeOpenIntoCache(openRes) {
    const cur = getChatsCache();
    const id = openRes.conversation_id;
    const filtered = cur.filter((x) => (x.conversation_id || x.id) !== id);
    filtered.unshift({
      id,
      conversation_id: id,
      title: openRes.peer.username,
      subtitle: "",
      peer: openRes.peer,
    });
    setChatsCache(filtered);
  }

  function renderChats(root, tabOpts = {}) {
    root.innerHTML = wrapTabContent(
      `
      <div class="ms-search">
        <input type="search" id="chat-search" placeholder="Поиск" autocomplete="off" />
      </div>
      <div id="user-search-results" class="ms-user-panel hidden"></div>
      <ul class="ms-chat-list" id="chat-list"></ul>
    `,
      tabOpts,
    );
    refreshIcons();

    const searchInput = root.querySelector("#chat-search");
    const listEl = root.querySelector("#chat-list");
    const userResults = root.querySelector("#user-search-results");

    function renderList(filter = "") {
      const chats = getChatsCache();
      const q = filter.trim().toLowerCase();
      const filtered = chats.filter((c) => {
        const t = (c.title || c.username || "").toLowerCase();
        return !q || t.includes(q);
      });
      if (!filtered.length) {
        listEl.innerHTML = `<li class="ms-empty">Нет чатов</li>`;
        refreshIcons();
        return;
      }
      listEl.innerHTML = filtered
        .map((c) => {
          const av = safeAvatarSrc(c.peer?.avatar)
            ? `<img src="${safeAvatarSrc(c.peer.avatar)}" alt="" />`
            : `<span style="color:${avatarColorSeed(c.peer?.username || c.title)}">${escapeHtml((c.title || "?").slice(0, 1))}</span>`;
          return `
            <li class="ms-chat-item" data-cid="${c.conversation_id || c.id}">
              <div class="ms-av">${av}</div>
              <div>
                <div class="ms-chat-title">${escapeHtml(c.title || c.peer?.username || "Чат")}</div>
                <div class="ms-chat-sub">${escapeHtml(c.subtitle || "")}</div>
              </div>
            </li>`;
        })
        .join("");
      refreshIcons();

      listEl.querySelectorAll(".ms-chat-item").forEach((row) => {
        row.addEventListener("click", () => {
          const cid = Number(row.dataset.cid);
          const item = getChatsCache().find((x) => (x.conversation_id || x.id) === cid);
          if (item) {
            openThread(cid, item.peer || { username: item.title });
          }
        });
      });
    }

    renderList("");

    let deb;
    searchInput.addEventListener("input", () => {
      const val = searchInput.value;
      renderList(val);
      clearTimeout(deb);
      if (val.trim().startsWith("@") && val.trim().length >= 2 && navigator.onLine) {
        deb = setTimeout(async () => {
          try {
            const res = await searchUsers(val.trim());
            if (!res.users.length) {
              userResults.classList.add("hidden");
              userResults.innerHTML = "";
              return;
            }
            userResults.classList.remove("hidden");
            userResults.innerHTML = `
              <h4>Найдено</h4>
              ${res.users
                .map(
                  (u, i) => `
                <div class="ms-user-row" data-i="${i}">
                  <span>${escapeHtml(u.username)}</span>
                  <button type="button" class="ms-mini">Написать</button>
                </div>`,
                )
                .join("")}`;
            refreshIcons();
            userResults.querySelectorAll(".ms-user-row").forEach((row) => {
              const u = res.users[Number(row.dataset.i)];
              row.querySelector("button").addEventListener("click", async () => {
                try {
                  const o = await openChat(u.username);
                  mergeOpenIntoCache(o);
                  await openThread(o.conversation_id, o.peer);
                } catch (e) {
                  alert(e.message);
                }
              });
            });
          } catch {
            userResults.classList.add("hidden");
          }
        }, 250);
      } else {
        userResults.classList.add("hidden");
      }
    });
  }

  function renderContacts(root, tabOpts = {}) {
    root.innerHTML = wrapTabContent(
      `
      <div class="ms-search">
        <input type="search" id="contact-search" placeholder="Поиск по @user_id" autocomplete="off" />
      </div>
      <div id="contacts-list" class="ms-user-panel hidden"></div>
      <div id="contact-results" class="ms-user-panel hidden"></div>
      <p class="ms-empty" style="padding:24px">Введи @ и часть ника, чтобы найти пользователя.</p>
    `,
      tabOpts,
    );
    refreshIcons();
    const input = root.querySelector("#contact-search");
    const contactsList = root.querySelector("#contacts-list");
    const out = root.querySelector("#contact-results");
    (async () => {
      try {
        const res = await fetchContacts();
        if (!res.contacts?.length) {
          return;
        }
        contactsList.classList.remove("hidden");
        contactsList.innerHTML = `
          <h4>Контакты</h4>
          ${res.contacts
            .map(
              (u) => `
            <div class="ms-user-row">
              <span>${escapeHtml(u.username)}</span>
              <button type="button" class="ms-mini" data-un="${escapeHtml(u.username)}">Чат</button>
            </div>`,
            )
            .join("")}
        `;
        contactsList.querySelectorAll("button[data-un]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              const o = await openChat(btn.dataset.un);
              mergeOpenIntoCache(o);
              section = "chats";
              container.querySelectorAll("#ms-nav button").forEach((b) => {
                b.classList.toggle("active", b.dataset.section === "chats");
              });
              container.querySelector("#ms-title").textContent = TITLES.chats;
              await openThread(o.conversation_id, o.peer);
            } catch (e) {
              alert(e.message);
            }
          });
        });
      } catch {
        /* ignore */
      }
    })();
    let deb;
    input.addEventListener("input", () => {
      const val = input.value.trim();
      clearTimeout(deb);
      if (val.length < 2 || !navigator.onLine) {
        out.classList.add("hidden");
        return;
      }
      deb = setTimeout(async () => {
        try {
          const res = await searchUsers(val.startsWith("@") ? val : `@${val}`);
          if (!res.users.length) {
            out.classList.add("hidden");
            return;
          }
          out.classList.remove("hidden");
          out.innerHTML = `
            <h4>Пользователи</h4>
            ${res.users
              .map(
                (u, i) => `
              <div class="ms-user-row" data-ci="${i}">
                <span>${escapeHtml(u.username)}</span>
                <button type="button" class="ms-mini">Написать</button>
              </div>`,
              )
              .join("")}`;
          refreshIcons();
          out.querySelectorAll(".ms-user-row").forEach((row) => {
            const u = res.users[Number(row.dataset.ci)];
            row.querySelector("button").addEventListener("click", async () => {
              try {
                const o = await openChat(u.username);
                mergeOpenIntoCache(o);
                section = "chats";
                container.querySelectorAll("#ms-nav button").forEach((b) => {
                  b.classList.toggle("active", b.dataset.section === "chats");
                });
                container.querySelector("#ms-title").textContent = TITLES.chats;
                await openThread(o.conversation_id, o.peer);
              } catch (e) {
                alert(e.message);
              }
            });
          });
        } catch {
          out.classList.add("hidden");
        }
      }, 250);
    });
  }

  function renderProfile(root, tabOpts = {}) {
    const av = safeAvatarSrc(currentUser.avatar)
      ? `<img src="${safeAvatarSrc(currentUser.avatar)}" alt="" />`
      : escapeHtml((currentUser.username || "?").slice(0, 1));

    const pHidden = (t) => (profileTab === t ? "" : "hidden");
    const pr = privacyFromUser(currentUser);
    const avChecked = (v) => (pr.avatar === v ? "checked" : "");
    const nmChecked = (v) => (pr.name === v ? "checked" : "");

    const menuHidden = profileMenuMode ? "" : "hidden";
    const detailHidden = profileMenuMode ? "hidden" : "";

    root.innerHTML = wrapTabContent(
      `
      <div class="ms-profile-tg">
        <div class="pf-menu-view ${menuHidden}">
          <div class="pf-hero">
            <label class="ms-avatar-btn pf-avatar-block">
              <div class="ms-avatar-lg">${av}</div>
              <input type="file" id="avatar-input" accept="image/*" hidden />
              <span class="pf-hint">Нажми, чтобы сменить аватар</span>
            </label>
          </div>
          <nav class="pf-menu-tiles" aria-label="Разделы профиля">
            <button type="button" class="pf-menu-tile" data-tab="about">
              <span class="pf-menu-tile-icon"><i data-lucide="user"></i></span>
              <span class="pf-menu-tile-main">
                <span class="pf-menu-tile-title">О себе</span>
                <span class="pf-menu-tile-sub">Имя, описание, user_id</span>
              </span>
              <i data-lucide="chevron-right" class="pf-menu-tile-chevron"></i>
            </button>
            <button type="button" class="pf-menu-tile" data-tab="privacy">
              <span class="pf-menu-tile-icon"><i data-lucide="shield"></i></span>
              <span class="pf-menu-tile-main">
                <span class="pf-menu-tile-title">Приватность</span>
                <span class="pf-menu-tile-sub">Фото и имя для других</span>
              </span>
              <i data-lucide="chevron-right" class="pf-menu-tile-chevron"></i>
            </button>
            <button type="button" class="pf-menu-tile" data-tab="contact">
              <span class="pf-menu-tile-icon"><i data-lucide="at-sign"></i></span>
              <span class="pf-menu-tile-main">
                <span class="pf-menu-tile-title">Связь</span>
                <span class="pf-menu-tile-sub">Почта и телефон</span>
              </span>
              <i data-lucide="chevron-right" class="pf-menu-tile-chevron"></i>
            </button>
            <button type="button" class="pf-menu-tile" data-tab="account">
              <span class="pf-menu-tile-icon"><i data-lucide="settings"></i></span>
              <span class="pf-menu-tile-main">
                <span class="pf-menu-tile-title">Аккаунт</span>
                <span class="pf-menu-tile-sub">Выход и безопасность</span>
              </span>
              <i data-lucide="chevron-right" class="pf-menu-tile-chevron"></i>
            </button>
          </nav>
        </div>

        <div class="pf-detail-view ${detailHidden}">
          <div class="pf-detail-head">
            <button type="button" class="pf-back-btn" id="pf-back-profile" aria-label="Назад к профилю">
              <i data-lucide="arrow-left"></i>
            </button>
            <h2 class="pf-detail-heading">${escapeHtml(PROFILE_DETAIL_TITLES[profileTab] || "Профиль")}</h2>
          </div>
          <div class="pf-detail-scroll">
        <div class="pf-panel ${pHidden("about")}" data-panel="about">
          <div class="pf-tiles pf-tiles--stack">
            <div class="pf-tile">
              <i data-lucide="user-circle"></i>
              <div class="pf-tile-body">
                <span class="pf-tile-label">user_id</span>
                <input id="pf-username" class="pf-tile-input" value="${escapeHtml((currentUser.username || "@").replace(/^@/, ""))}" maxlength="20" />
              </div>
            </div>
            <div class="pf-tile">
              <i data-lucide="user"></i>
              <div class="pf-tile-body">
                <span class="pf-tile-label">Имя</span>
                <input id="pf-first-name" class="pf-tile-input" value="${escapeHtml(currentUser.first_name || "")}" maxlength="40" />
              </div>
            </div>
            <div class="pf-tile">
              <i data-lucide="users"></i>
              <div class="pf-tile-body">
                <span class="pf-tile-label">Фамилия</span>
                <input id="pf-last-name" class="pf-tile-input" value="${escapeHtml(currentUser.last_name || "")}" maxlength="40" />
              </div>
            </div>
            <div class="pf-tile pf-tile--textarea">
              <i data-lucide="align-left"></i>
              <div class="pf-tile-body">
                <span class="pf-tile-label">Описание</span>
                <textarea id="pf-bio" rows="3" maxlength="200">${escapeHtml(currentUser.bio || "")}</textarea>
              </div>
            </div>
          </div>
          <p class="pf-footnote"><code>user_id</code> — до 20 символов, смена не чаще раза в сутки.</p>
          <button type="button" class="btn btn-secondary btn-wide" id="pf-save-about">Сохранить</button>
        </div>

        <div class="pf-panel ${pHidden("privacy")}" data-panel="privacy">
          <p class="pf-section-desc">Кто видит фото и имя, пока вы не в контактах</p>
          <div class="pf-tiles pf-tiles--stack">
            <div class="pf-privacy-block">
              <div class="pf-privacy-title"><i data-lucide="image"></i> Фото профиля</div>
              <div class="pf-radio-group">
                <label class="pf-radio"><input type="radio" name="pf-privacy-av" value="everyone" ${avChecked("everyone")} /> Всем</label>
                <label class="pf-radio"><input type="radio" name="pf-privacy-av" value="contacts" ${avChecked("contacts")} /> Только контактам</label>
                <label class="pf-radio"><input type="radio" name="pf-privacy-av" value="nobody" ${avChecked("nobody")} /> Никому</label>
              </div>
            </div>
            <div class="pf-privacy-block">
              <div class="pf-privacy-title"><i data-lucide="user"></i> Имя и фамилия</div>
              <div class="pf-radio-group">
                <label class="pf-radio"><input type="radio" name="pf-privacy-nm" value="everyone" ${nmChecked("everyone")} /> Всем</label>
                <label class="pf-radio"><input type="radio" name="pf-privacy-nm" value="contacts" ${nmChecked("contacts")} /> Только контактам</label>
                <label class="pf-radio"><input type="radio" name="pf-privacy-nm" value="nobody" ${nmChecked("nobody")} /> Никому</label>
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-wide" id="pf-save-privacy">Сохранить</button>
        </div>

        <div class="pf-panel ${pHidden("contact")}" data-panel="contact">
          <div class="pf-tiles pf-tiles--stack">
            <div class="pf-tile">
              <i data-lucide="mail"></i>
              <div class="pf-tile-body">
                <span class="pf-tile-label">Почта</span>
                <input id="pf-email" type="email" class="pf-tile-input" value="${escapeHtml(currentUser.email || "")}" />
              </div>
            </div>
            <div class="pf-tile">
              <i data-lucide="smartphone"></i>
              <div class="pf-tile-body">
                <span class="pf-tile-label">Телефон</span>
                <input id="pf-phone" class="pf-tile-input" inputmode="numeric" value="${escapeHtml(currentUser.phone || "")}" />
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-wide" id="pf-save-contact">Сохранить</button>
        </div>

        <div class="pf-panel ${pHidden("account")}" data-panel="account">
          <div class="ms-card pf-e2e-card">
            <p><i data-lucide="lock"></i> E2EE: переписка шифруется на устройстве; на сервере только шифртекст.</p>
          </div>
          <button type="button" class="btn btn-logout btn-wide" id="btn-logout">
            <i data-lucide="log-out"></i> Выйти
          </button>
          <details class="ms-details">
            <summary>Удаление аккаунта</summary>
            <form id="delete-form" class="ms-delete-form">
              <label>Почта<input type="email" name="email" value="${escapeHtml(currentUser.email || "")}" required /></label>
              <label>Пароль<input type="password" name="password" minlength="6" required /></label>
              <label>Код<div class="auth-inline"><input type="text" name="code" maxlength="6" /><button type="button" class="btn btn-secondary" id="del-code">Код</button></div></label>
              <button type="submit" class="btn btn-danger btn-wide">Удалить аккаунт</button>
            </form>
            <div class="auth-msg" id="del-msg"></div>
          </details>
        </div>
          </div>
        </div>
      </div>
    `,
      tabOpts,
    );
    refreshIcons();

    root.querySelectorAll(".pf-menu-tile").forEach((btn) => {
      btn.addEventListener("click", () => {
        profileTab = btn.dataset.tab || "about";
        profileMenuMode = false;
        renderProfile(root, { animateTab: true });
      });
    });
    const backBtn = root.querySelector("#pf-back-profile");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        profileMenuMode = true;
        renderProfile(root, { animateTab: true });
      });
    }

    const fileInput = root.querySelector("#avatar-input");
    const phoneInput = root.querySelector("#pf-phone");
    if (phoneInput) {
      phoneInput.addEventListener("input", () => {
        phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 15);
      });
    }

    root.querySelector("#pf-save-about").addEventListener("click", async () => {
      try {
        const slugInput = root.querySelector("#pf-username").value.trim().toLowerCase();
        const currentSlug = (currentUser.username || "").replace(/^@/, "").toLowerCase();
        const body = {
          first_name: root.querySelector("#pf-first-name").value.trim(),
          last_name: root.querySelector("#pf-last-name").value.trim(),
          bio: root.querySelector("#pf-bio").value.trim(),
        };
        if (slugInput && slugInput !== currentSlug) {
          body.username_slug = slugInput;
        }
        const res = await patchProfile(body);
        currentUser = res.user;
        saveSession(getToken(), currentUser);
        alert("Сохранено.");
        renderBody();
      } catch (e) {
        alert(e.message);
      }
    });

    root.querySelector("#pf-save-privacy").addEventListener("click", async () => {
      try {
        const av = root.querySelector('input[name="pf-privacy-av"]:checked');
        const nm = root.querySelector('input[name="pf-privacy-nm"]:checked');
        const res = await patchProfile({
          privacy_avatar: av ? av.value : "everyone",
          privacy_name: nm ? nm.value : "everyone",
        });
        currentUser = res.user;
        saveSession(getToken(), currentUser);
        alert("Сохранено.");
        renderBody();
      } catch (e) {
        alert(e.message);
      }
    });

    root.querySelector("#pf-save-contact").addEventListener("click", async () => {
      try {
        const res = await patchProfile({
          email: root.querySelector("#pf-email").value.trim().toLowerCase(),
          phone: root.querySelector("#pf-phone").value.trim(),
        });
        currentUser = res.user;
        saveSession(getToken(), currentUser);
        alert("Сохранено.");
        renderBody();
      } catch (e) {
        alert(e.message);
      }
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await patchProfile({ avatar: String(reader.result) });
          currentUser = res.user;
          saveSession(getToken(), currentUser);
          renderBody();
        } catch (e) {
          alert(e.message);
        }
      };
      reader.readAsDataURL(file);
    });

    root.querySelector("#btn-logout").addEventListener("click", async () => {
      try {
        await logoutSession();
      } catch {
        /* ignore */
      }
      clearSession();
      onBackToAuth();
    });

    const deleteForm = root.querySelector("#delete-form");
    const deleteMsg = root.querySelector("#del-msg");
    forceDigits(deleteForm.code, 6);
    root.querySelector("#del-code").addEventListener("click", async () => {
      try {
        const res = await sendDeleteCode({
          email: deleteForm.email.value.trim(),
          password: deleteForm.password.value,
        });
        setMessage(deleteMsg, res.message || "Код отправлен.", "success");
      } catch (e) {
        setMessage(deleteMsg, e.message, "error");
      }
    });
    deleteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await confirmDelete({
          email: deleteForm.email.value.trim(),
          password: deleteForm.password.value,
          code: deleteForm.code.value.trim(),
        });
        clearSession();
        onBackToAuth();
      } catch (e) {
        setMessage(deleteMsg, e.message, "error");
      }
    });
  }

  mountShell();
  (async () => {
    try {
      await ensureE2EKeys(getMe, uploadPublicKey);
      const me = await getMe();
      currentUser = me.user;
      saveSession(getToken(), currentUser);
    } catch (e) {
      console.error(e);
    }
    updateOfflineBanner();
    renderBody();
    syncFromServer();
  })();

  window.addEventListener("online", () => {
    updateOfflineBanner();
    setRefreshing(false);
    syncFromServer();
  });
  window.addEventListener("offline", () => {
    updateOfflineBanner();
    setRefreshing(true);
  });

  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}
