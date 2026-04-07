import { getMe } from "./api.js";
import { clearSession, loadSession, saveSession } from "./storage.js";
import { renderAuthScreen } from "./pages/auth.page.js";
import { renderMessengerScreen } from "./pages/messenger.page.js";

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
