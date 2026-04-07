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

Так можно открывать интерфейс с телефона по ссылке вида `https://username.github.io/repo/`, а API крутится только на компьютере.

1. **Сервер на ПК** по-прежнему: `python backend/server.py` (порт 8000). В `server.py` уже включён CORS `*`, отдельно ничего не нужно.
2. **Доступ из интернета к ПК**: подними **HTTPS-туннель** (браузер с GitHub Pages не даст ходить на «голый» HTTP с твоего ПК).
   - [ngrok](https://ngrok.com/): `ngrok http 8000` → возьми выданный `https://....ngrok-free.app`
   - или [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
3. **Фронт на GitHub Pages**: в репозитории **Settings → Pages** выбери источник **GitHub Actions** (не «ветка» — там доступны только корень или `/docs`, папки `/frontend` нет). В проекте уже есть workflow `.github/workflows/pages.yml`: он публикует содержимое папки `frontend/` при каждом push в `main`. После первого успешного запуска workflow сайт появится по ссылке из **Settings → Pages**.
4. В **`frontend/index.html`** в теге meta укажи URL туннеля **без** слэша в конце:

```html
<meta name="kareta-api-base" content="https://ВАШ-ID.ngrok-free.app" />
```

Альтернатива без правки HTML: перед подключением `app.js` вставить:

```html
<script>window.__KARETA_API_BASE__ = "https://ВАШ-ID.ngrok-free.app";</script>
```

5. Пока ПК выключен или туннель не запущен, сайт на GitHub откроется, но **запросы к API не дойдут** — это нормально для домашнего сервера.

**Проще для себя:** не использовать Pages, а заходить всегда на `http://127.0.0.1:8000` или по локальной сети `http://IP_ПК:8000` с телефона в той же Wi‑Fi.

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
├── .env.example
└── README.md
```

- `backend/server.py` — API; статика `/css/...` и `/js/...` из папок `frontend/css`, `frontend/js` (как на GitHub Pages).
- `frontend/` — единственная копия интерфейса (HTML, CSS, JS).
- `.env` и `backend/kareta.db` создаются локально и в git не входят.
