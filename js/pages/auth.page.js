import {
  completeRegister,
  sendLoginCode,
  sendRegisterCode,
  verifyLogin,
  verifyRegister,
} from "../api.js";
import { refreshIcons } from "../icons.js";

function forceDigits(input, maxLength = 6) {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, maxLength);
  });
}

function forceUsernameSlug(input, maxLength = 20) {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, maxLength);
  });
}

function setMessage(node, text, type = "") {
  node.textContent = text;
  node.className = `auth-msg ${type}`.trim();
}

function attachCooldown(button, initialSeconds, onFinish) {
  let seconds = initialSeconds;
  button.disabled = true;
  const original = button.innerHTML;
  button.textContent = `Повтор ${seconds}с`;
  const timer = setInterval(() => {
    seconds -= 1;
    if (seconds <= 0) {
      clearInterval(timer);
      button.innerHTML = original;
      onFinish();
      refreshIcons();
      return;
    }
    button.textContent = `Повтор ${seconds}с`;
  }, 1000);
}

function isFilled(value) {
  return value.trim().length > 0;
}

export function renderAuthScreen(container, { onAuthSuccess }) {
  container.innerHTML = `
    <div class="auth-screen">
      <div class="auth-brand">
        <i data-lucide="message-square-more"></i>
        <h1>KARETA <span>chat</span></h1>
      </div>
      <p class="auth-sub">Регистрация и вход</p>
      <div class="auth-tabs" id="auth-switch">
        <button type="button" class="auth-tab active" data-mode="register">
          <i data-lucide="user-plus"></i> Регистрация
        </button>
        <button type="button" class="auth-tab" data-mode="login">
          <i data-lucide="log-in"></i> Войти
        </button>
      </div>
      <section id="auth-content"></section>
    </div>
  `;
  refreshIcons();

  const switchRoot = container.querySelector("#auth-switch");
  const authContent = container.querySelector("#auth-content");

  function setMode(mode) {
    switchRoot.querySelectorAll(".auth-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    if (mode === "register") {
      renderRegisterForm(authContent, onAuthSuccess);
      return;
    }
    renderLoginForm(authContent, onAuthSuccess);
  }

  switchRoot.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) {
      return;
    }
    setMode(button.dataset.mode);
  });

  setMode("register");
}

function renderRegisterForm(root, onAuthSuccess) {
  root.innerHTML = `
    <form id="register-form" class="auth-form">
      <label>
        Почта
        <input type="email" name="email" placeholder="name@example.com" required />
      </label>
      <label>
        Телефон (опционально)
        <input type="text" name="phone" maxlength="15" placeholder="79001234567" />
      </label>
      <label>
        Пароль
        <input type="password" name="password" minlength="6" required />
      </label>
      <label>
        Код
        <div class="auth-inline">
          <input type="text" name="code" maxlength="6" placeholder="000000" required />
          <button class="btn btn-secondary" type="button" id="register-send-code" disabled>
            <i data-lucide="send"></i> Код
          </button>
        </div>
      </label>
      <p class="auth-hint">Код — не чаще 1 раза в минуту. Сначала почта и пароль.</p>
      <button class="btn btn-primary" type="submit" id="register-submit">
        <i data-lucide="shield-check"></i> Подтвердить код
      </button>
    </form>
    <div class="auth-msg" id="register-message"></div>
    <div id="register-username-step"></div>
  `;
  refreshIcons();

  const form = root.querySelector("#register-form");
  const sendBtn = root.querySelector("#register-send-code");
  const msg = root.querySelector("#register-message");
  const usernameStep = root.querySelector("#register-username-step");
  forceDigits(form.code, 6);
  forceDigits(form.phone, 15);

  let registerCooldownActive = false;

  function updateRegisterSendButton() {
    const canSend =
      !registerCooldownActive &&
      isFilled(form.email.value) &&
      isFilled(form.password.value) &&
      form.password.value.length >= 6;
    sendBtn.disabled = !canSend;
  }

  form.email.addEventListener("input", updateRegisterSendButton);
  form.password.addEventListener("input", updateRegisterSendButton);
  updateRegisterSendButton();

  sendBtn.addEventListener("click", async () => {
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email) {
      setMessage(msg, "Укажи почту.", "error");
      return;
    }
    if (password.length < 6) {
      setMessage(msg, "Пароль минимум 6 символов.", "error");
      return;
    }
    try {
      const result = await sendRegisterCode({ email, password });
      setMessage(msg, "Код отправлен.", "success");
      registerCooldownActive = true;
      attachCooldown(sendBtn, result.cooldown_seconds || 60, () => {
        registerCooldownActive = false;
        updateRegisterSendButton();
      });
    } catch (error) {
      setMessage(msg, error.message, "error");
      const match = /(\d+)\s*(seconds|сек)/i.exec(error.message);
      if (match) {
        registerCooldownActive = true;
        attachCooldown(sendBtn, Number(match[1]), () => {
          registerCooldownActive = false;
          updateRegisterSendButton();
        });
      }
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      password: form.password.value,
      code: form.code.value.trim(),
    };
    if (!payload.phone) {
      delete payload.phone;
    }
    try {
      const result = await verifyRegister(payload);
      setMessage(msg, "Код подтверждён. Задай user_id.", "success");
      renderUsernameStep(usernameStep, result.registration_token, onAuthSuccess, msg);
    } catch (error) {
      setMessage(msg, error.message, "error");
    }
  });
}

function renderUsernameStep(node, registrationToken, onAuthSuccess, msgNode) {
  node.innerHTML = `
    <form id="username-form" class="auth-form auth-form--step">
      <label>
        user_id
        <div class="auth-inline">
          <span class="auth-prefix">@</span>
          <input type="text" name="username_slug" minlength="3" maxlength="20" placeholder="my_name" required />
        </div>
      </label>
      <p class="auth-hint">Только латиница, цифры и _. Символ @ добавится сам.</p>
      <button class="btn btn-primary" type="submit">
        <i data-lucide="check"></i> Завершить
      </button>
    </form>
  `;
  refreshIcons();
  const usernameForm = node.querySelector("#username-form");
  forceUsernameSlug(usernameForm.username_slug, 20);
  usernameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await completeRegister({
        registration_token: registrationToken,
        username_slug: usernameForm.username_slug.value.trim(),
      });
      setMessage(msgNode, "Готово.", "success");
      onAuthSuccess({ user: result.user, sessionToken: result.session_token });
    } catch (error) {
      setMessage(msgNode, error.message, "error");
    }
  });
}

function renderLoginForm(root, onAuthSuccess) {
  root.innerHTML = `
    <form id="login-form" class="auth-form">
      <label>
        Почта
        <input type="email" name="email" placeholder="name@example.com" required />
      </label>
      <label>
        Пароль
        <input type="password" name="password" minlength="6" required />
      </label>
      <label>
        Код
        <div class="auth-inline">
          <input type="text" name="code" maxlength="6" placeholder="000000" required />
          <button class="btn btn-secondary" type="button" id="login-send-code" disabled>
            <i data-lucide="send"></i> Код
          </button>
        </div>
      </label>
      <p class="auth-hint">Сначала почта и пароль.</p>
      <button class="btn btn-primary" type="submit">
        <i data-lucide="log-in"></i> Войти
      </button>
    </form>
    <div class="auth-msg" id="login-message"></div>
  `;
  refreshIcons();
  const form = root.querySelector("#login-form");
  const sendBtn = root.querySelector("#login-send-code");
  const msg = root.querySelector("#login-message");
  forceDigits(form.code, 6);
  let loginCooldownActive = false;

  function updateLoginSendButton() {
    const canSend =
      !loginCooldownActive &&
      isFilled(form.email.value) &&
      isFilled(form.password.value) &&
      form.password.value.length >= 6;
    sendBtn.disabled = !canSend;
  }

  form.email.addEventListener("input", updateLoginSendButton);
  form.password.addEventListener("input", updateLoginSendButton);
  updateLoginSendButton();

  sendBtn.addEventListener("click", async () => {
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) {
      setMessage(msg, "Введи почту и пароль.", "error");
      return;
    }
    try {
      const result = await sendLoginCode({ email, password });
      setMessage(msg, "Код отправлен.", "success");
      loginCooldownActive = true;
      attachCooldown(sendBtn, result.cooldown_seconds || 60, () => {
        loginCooldownActive = false;
        updateLoginSendButton();
      });
    } catch (error) {
      setMessage(msg, error.message, "error");
      const match = /(\d+)\s*(seconds|сек)/i.exec(error.message);
      if (match) {
        loginCooldownActive = true;
        attachCooldown(sendBtn, Number(match[1]), () => {
          loginCooldownActive = false;
          updateLoginSendButton();
        });
      }
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await verifyLogin({
        email: form.email.value.trim(),
        password: form.password.value,
        code: form.code.value.trim(),
      });
      setMessage(msg, "Вход выполнен.", "success");
      onAuthSuccess({ user: result.user, sessionToken: result.session_token });
    } catch (error) {
      setMessage(msg, error.message, "error");
    }
  });
}
