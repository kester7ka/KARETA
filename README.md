# KARETA

Мессенджер: **FastAPI** + SQLite, фронт на чистом HTML/CSS/JS, E2EE в переписках.

## Запуск у себя на ПК (всё в одном)

1. Установи [Python 3.10+](https://www.python.org/downloads/).
2. В корне проекта: `pip install -r requirements.txt`
3. Скопируй `.env.example` → `.env` и при необходимости настрой SMTP (коды на почту).
4. Запуск:
   - двойной клик по `start_server.bat`, **или**
   - `python backend/server.py`
5. Сервер слушает **порт 5000** на всех интерфейсах (`0.0.0.0`). Локально: [http://127.0.0.1:5000](http://127.0.0.1:5000) — отдаётся и API, и статика из `frontend/`.

В фаерволе Windows открой входящий **TCP 5000**, если нужен доступ из интернета по белому IP.

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

## Интерфейс на GitHub Pages, API на твоём ПК (статический IP)

1. На роутере/у провайдера у тебя **статический внешний IP** (например для доступа из интернета).
2. Запусти **`start_server.bat`** на ПК, чтобы слушался порт **5000**.
3. В **`frontend/index.html`** в meta **`kareta-api-base`** укажи базовый URL API **без** слэша в конце, например:

```html
<meta name="kareta-api-base" content="http://93.179.75.247:5000" />
```

Подставь свой IP при смене адреса.

4. **`git add`**, **`commit`**, **`push`** — после GitHub Actions открой сайт на Pages.

**Важно:** GitHub Pages отдаёт страницу по **HTTPS**. Запросы с неё на **`http://`…** API браузер часто **блокирует** (mixed content). Варианты: поднять **HTTPS** на своём сервере (обратный прокси с сертификатом), использовать туннель с HTTPS, либо открывать интерфейс не с `github.io`, а напрямую с ПК (`http://ТВОЙ_IP:5000`), оставив **`kareta-api-base`** пустым.

Пока ПК выключен или порт закрыт, с GitHub API не ответит.

### Pages и CORS

1. **Сервер:** `python backend/server.py` (порт **5000**), CORS в коде уже `*`.
2. **GitHub Pages:** **Settings → Pages** → источник **GitHub Actions**; workflow `.github/workflows/pages.yml` публикует папку **`frontend/`** при push в `main`.

**Только локальная сеть:** `http://127.0.0.1:5000` или `http://IP_ПК_в_LAN:5000` — meta **`kareta-api-base`** можно оставить **пустым** (тот же origin).

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
