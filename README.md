# KARETA

Мессенджер: **FastAPI** + SQLite, фронт на чистом HTML/CSS/JS, E2EE в переписках.

## Запуск у себя на ПК (всё в одном)

1. Установи [Python 3.10+](https://www.python.org/downloads/).
2. В корне проекта: `pip install -r requirements.txt`
3. Скопируй `.env.example` → `.env` и при необходимости настрой SMTP (коды на почту).
4. Запуск:
   - двойной клик по `start_server.bat`, **или**
   - `python backend/server.py`
5. Открой в браузере: [http://127.0.0.1:8000](http://127.0.0.1:8000) — сервер отдаёт и API, и статику из `frontend/`.

`.env` и `backend/kareta.db` в репозиторий не попадают (см. `.gitignore`).

---

## Выложить код на GitHub

1. [Создай репозиторий](https://github.com/new) на GitHub (без README, если уже есть локальный проект).
2. В папке проекта:

```bash
git init
git add .
git commit -m "Initial commit: KARETA messenger"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/ТВОЙ_РЕПО.git
git push -u origin main
```

Дальше изменения: `git add`, `git commit`, `git push`.

---

## «Веб» на GitHub Pages, а сервер на твоём ПК

Так можно открывать интерфейс по `https://username.github.io/repo/`, а API крутится только на компьютере.

### Бесплатный туннель без подписок (Cloudflare quick)

1. Скачай **cloudflared** для Windows: [релизы cloudflared](https://github.com/cloudflare/cloudflared/releases) — файл вроде `cloudflared-windows-amd64.exe`, переименуй в **`cloudflared.exe`** и положи в **корень папки KARETA** (рядом с `start_server.bat`). В git он не попадёт — см. `.gitignore`.
2. Запусти **`start_server.bat`** (сервер на порту 8000).
3. Запусти **`start_tunnel.bat`** — в окне появится HTTPS-адрес вида `https://….trycloudflare.com`. Аккаунт Cloudflare для этого режима не нужен.
4. Открой **`frontend/index.html`**, в meta **`kareta-api-base`** вставь этот URL **без** слэша в конце, сохрани:

```html
<meta name="kareta-api-base" content="https://твой-поддомен.trycloudflare.com" />
```

5. **`git add`**, **`commit`**, **`push`** — подожди GitHub Actions, открой сайт на Pages.

При каждом **новом** запуске quick-tunnel URL часто **меняется** — тогда снова правь meta и push. Пока ПК выключен или туннель не запущен, с GitHub API не ответит.

**Ошибка 405 на телефоне с github.io:** чаще всего в `kareta-api-base` пусто или телефон открыл **старую** закэшированную страницу — запросы улетают на сам GitHub, а не на туннель. Обнови meta, сделай push, на телефоне открой сайт заново (или «без кеша»). Альтернатива: в закладках держи **прямую** ссылку `https://….trycloudflare.com` (тот же фронт с твоего ПК, без cross-origin).

**Альтернативы:** [ngrok](https://ngrok.com/) (`ngrok http 8000`), свой HTTPS на роутере — суть та же: в meta нужен **HTTPS**-URL до твоего порта 8000.

### Pages и CORS

1. **Сервер:** `python backend/server.py` (порт 8000), CORS в `server.py` уже `*`.
2. **GitHub Pages:** **Settings → Pages** → источник **GitHub Actions**; workflow `.github/workflows/pages.yml` публикует папку **`frontend/`** при push в `main`.

**Проще без интернета:** только `http://127.0.0.1:8000` или `http://IP_ПК:8000` в той же Wi‑Fi — туннель не нужен, meta **`kareta-api-base`** оставь **пустым**.

---

## Почта (Gmail)

См. комментарии в `.env.example`. Без SMTP коды печатаются в консоли сервера.

---

## Структура репозитория

Весь фронтенд — **только** в папке `frontend/`. В корне проекта **не** должно быть отдельных `css/`, `js/`, `index.html` (это дубликаты и путают GitHub Pages и сервер).

```
KARETA/
├── .github/workflows/pages.yml   # деплой frontend/ на GitHub Pages
├── backend/
│   └── server.py                 # API + раздача статики из frontend/
├── frontend/
│   ├── index.html
│   ├── css/
│   └── js/
├── requirements.txt
├── start_server.bat
├── start_tunnel.bat        # Cloudflare quick tunnel → порт 8000 (нужен cloudflared.exe)
├── .env.example
└── README.md
```

- `backend/server.py` — API; статика `/css/...` и `/js/...` из папок `frontend/css`, `frontend/js` (как на GitHub Pages).
- `frontend/` — единственная копия интерфейса (HTML, CSS, JS).
- `.env` и `backend/kareta.db` создаются локально и в git не входят.
