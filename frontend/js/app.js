import { getMe, apiBase } from "./api.js";
import { clearSession, loadSession, saveSession } from "./storage.js";
import { renderAuthScreen } from "./pages/auth.page.js";
import { renderMessengerScreen } from "./pages/messenger.page.js";

function showGithubApiHint() {
  const host = window.location.hostname || "";
  if (!host.endsWith("github.io")) return;
  if (apiBase()) return;
  const el = document.createElement("div");
  el.textContent =
    "KARETA: в meta kareta-api-base не задан URL API — запросы уходят на GitHub Pages и ломаются. Укажи адрес бэкенда в frontend/index.html и сделай push. Страница на https://github.io не сможет ходить на http://… API (mixed content) — тогда нужен HTTPS у API или открывай интерфейс с того же хоста, что и API.";
  el.style.cssText =
    "position:fixed;inset:0 auto auto 0;right:0;z-index:99999;padding:12px;background:#3d1212;color:#f5e5e5;font:14px/1.45 system-ui,sans-serif;text-align:center;";
  document.body.prepend(el);
}
showGithubApiHint();

const root = document.querySelector("#app-root");
const appShell = document.querySelector(".app-shell");
const appHeader = document.querySelector(".app-header");
const state = { user: null };

function setMessengerLayout(on) {
  if (appShell) {
    appShell.classList.toggle("app-shell--wide", on);
  }
  if (appHeader) {
    appHeader.classList.toggle("hidden", on);
  }
}

function onAuthSuccess({ user, sessionToken }) {
  saveSession(sessionToken, user);
  state.user = user;
  setMessengerLayout(true);
  renderMessengerScreen(root, {
    user: state.user,
    onBackToAuth: () => {
      state.user = null;
      clearSession();
      setMessengerLayout(false);
      renderAuthScreen(root, { onAuthSuccess });
    },
  });
}

async function bootstrap() {
  const { token, user } = loadSession();
  if (token && user) {
    try {
      const result = await getMe();
      state.user = result.user;
      saveSession(token, result.user);
      setMessengerLayout(true);
      renderMessengerScreen(root, {
        user: state.user,
        onBackToAuth: () => {
          state.user = null;
          clearSession();
          setMessengerLayout(false);
          renderAuthScreen(root, { onAuthSuccess });
        },
      });
      return;
    } catch {
      clearSession();
    }
  }
  setMessengerLayout(false);
  renderAuthScreen(root, { onAuthSuccess });
}

bootstrap();
