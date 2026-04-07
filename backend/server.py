import asyncio
import hashlib
import os
import random
import re
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Optional, Tuple

import aiosqlite
import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, field_validator

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
DB_PATH = BASE_DIR / "backend" / "kareta.db"
FRONTEND_DIR = BASE_DIR / "frontend"

CODE_TTL_MINUTES = 10
CODE_COOLDOWN_SECONDS = 60
REGISTRATION_SESSION_TTL_MINUTES = 15
SESSION_TTL_DAYS = 30

app = FastAPI(title="KARETA API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")

security = HTTPBearer(auto_error=False)


class RegisterSendCodePayload(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 6:
            raise ValueError("Пароль должен быть минимум 6 символов.")
        return value


class RegisterVerifyPayload(BaseModel):
    email: EmailStr
    phone: Optional[str] = None
    password: str
    code: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not re.fullmatch(r"^[0-9]{7,15}$", value):
            raise ValueError("Телефон должен содержать только 7-15 цифр.")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 6:
            raise ValueError("Пароль должен быть минимум 6 символов.")
        return value

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if not re.fullmatch(r"^\d{6}$", value):
            raise ValueError("Код должен состоять из 6 цифр.")
        return value


class RegisterCompletePayload(BaseModel):
    registration_token: str
    username_slug: str

    @field_validator("username_slug")
    @classmethod
    def validate_username_slug(cls, value: str) -> str:
        if not re.fullmatch(r"^[a-zA-Z0-9_]{3,20}$", value):
            raise ValueError("user_id: только латиница, цифры и _, от 3 до 20 символов.")
        return value.lower()


class LoginSendCodePayload(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 6:
            raise ValueError("Пароль должен быть минимум 6 символов.")
        return value


class LoginVerifyPayload(BaseModel):
    email: EmailStr
    password: str
    code: str

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if not re.fullmatch(r"^\d{6}$", value):
            raise ValueError("Код должен состоять из 6 цифр.")
        return value


class DeleteSendCodePayload(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 6:
            raise ValueError("Пароль должен быть минимум 6 символов.")
        return value


class ProfileUpdatePayload(BaseModel):
    avatar: Optional[str] = None
    username_slug: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    bio: Optional[str] = None
    show_avatar_non_contacts: Optional[bool] = None
    show_name_non_contacts: Optional[bool] = None
    privacy_avatar: Optional[str] = None
    privacy_name: Optional[str] = None

    @field_validator("avatar")
    @classmethod
    def validate_avatar(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if len(value) > 600_000:
            raise ValueError("Аватар слишком большой.")
        return value

    @field_validator("username_slug")
    @classmethod
    def validate_username_slug(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        raw = value.strip().lower()
        if not re.fullmatch(r"^[a-z0-9_]{3,20}$", raw):
            raise ValueError("user_id: только латиница, цифры и _, от 3 до 20 символов.")
        return raw

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        raw = value.strip()
        if not re.fullmatch(r"^[0-9]{7,15}$", raw):
            raise ValueError("Телефон должен содержать только 7-15 цифр.")
        return raw

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_names(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        raw = value.strip()
        if len(raw) > 40:
            raise ValueError("Имя и фамилия не должны быть длиннее 40 символов.")
        return raw or None

    @field_validator("bio")
    @classmethod
    def validate_bio(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        raw = value.strip()
        if len(raw) > 200:
            raise ValueError("Описание не должно быть длиннее 200 символов.")
        return raw

    @field_validator("privacy_avatar", "privacy_name")
    @classmethod
    def validate_privacy_level(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        raw = value.strip().lower()
        if raw not in ("everyone", "contacts", "nobody"):
            raise ValueError("Некорректный уровень приватности.")
        return raw


class OpenChatPayload(BaseModel):
    peer_username: str

    @field_validator("peer_username")
    @classmethod
    def normalize_peer(cls, value: str) -> str:
        raw = value.strip()
        if not raw.startswith("@"):
            raw = f"@{raw.lstrip('@')}"
        slug = raw[1:]
        if not re.fullmatch(r"^[a-zA-Z0-9_]{3,20}$", slug):
            raise ValueError("Некорректный user_id.")
        return f"@{slug.lower()}"


class PublicKeyPayload(BaseModel):
    public_key_spki_b64: str

    @field_validator("public_key_spki_b64")
    @classmethod
    def validate_spki(cls, value: str) -> str:
        raw = value.strip()
        if len(raw) < 32 or len(raw) > 12000:
            raise ValueError("Некорректный публичный ключ.")
        return raw


class EncryptedMessagePayload(BaseModel):
    iv_b64: str
    ciphertext_b64: str

    @field_validator("iv_b64", "ciphertext_b64")
    @classmethod
    def validate_b64_parts(cls, value: str) -> str:
        raw = value.strip()
        if len(raw) < 4 or len(raw) > 65536:
            raise ValueError("Некорректные данные сообщения.")
        return raw


class DeleteConfirmPayload(BaseModel):
    email: EmailStr
    password: str
    code: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 6:
            raise ValueError("Пароль должен быть минимум 6 символов.")
        return value

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if not re.fullmatch(r"^\d{6}$", value):
            raise ValueError("Код должен состоять из 6 цифр.")
        return value


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def dt_to_iso(value: datetime) -> str:
    return value.isoformat()


def iso_to_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def generate_token() -> str:
    return secrets.token_urlsafe(32)


async def create_session_for_user(user_id: int) -> str:
    token = generate_token()
    expires = utc_now() + timedelta(days=SESSION_TTL_DAYS)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
            (token, user_id, dt_to_iso(expires)),
        )
        await db.commit()
    return token


def public_user(user: dict) -> dict:
    return {key: value for key, value in user.items() if key != "id"}


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Требуется авторизация.")
    token = credentials.credentials
    now = utc_now()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            SELECT
                u.id,
                u.system_id,
                u.username,
                u.email,
                u.phone,
                u.avatar,
                u.public_key_spki,
                u.first_name,
                u.last_name,
                u.bio,
                u.show_avatar_non_contacts,
                u.show_name_non_contacts,
                u.username_changed_at,
                u.privacy_avatar,
                u.privacy_name
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ?
            LIMIT 1
            """,
            (token, dt_to_iso(now)),
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Сессия недействительна или истекла.")
    return {
        "id": row[0],
        "system_id": row[1],
        "username": row[2],
        "email": row[3],
        "phone": row[4],
        "avatar": row[5],
        "public_key_spki": row[6],
        "first_name": row[7],
        "last_name": row[8],
        "bio": row[9],
        "show_avatar_non_contacts": bool(row[10]) if row[10] is not None else True,
        "show_name_non_contacts": bool(row[11]) if row[11] is not None else True,
        "username_changed_at": row[12],
        "privacy_avatar": row[13] or "everyone",
        "privacy_name": row[14] or "everyone",
    }


async def ensure_column(db: aiosqlite.Connection, table: str, column: str, definition: str) -> None:
    info_cursor = await db.execute(f"PRAGMA table_info({table})")
    columns = [row[1] for row in await info_cursor.fetchall()]
    if column not in columns:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


async def create_user_system_id(db: aiosqlite.Connection) -> str:
    for _ in range(10):
        candidate = str(random.randint(1000000000, 9999999999))
        check = await db.execute("SELECT id FROM users WHERE system_id = ? LIMIT 1", (candidate,))
        if await check.fetchone() is None:
            return candidate
    raise HTTPException(status_code=500, detail="Не удалось сгенерировать уникальный ID.")


def _send_email_sync(target_email: str, code: str) -> None:
    smtp_host = (os.getenv("SMTP_HOST") or "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = (os.getenv("SMTP_USER") or "").strip()
    smtp_pass = (os.getenv("SMTP_PASS") or "").replace(" ", "")
    from_email = (os.getenv("SMTP_FROM") or smtp_user or "no-reply@kareta.local").strip()
    if smtp_user and "@gmail.com" in smtp_user.lower() and not smtp_host:
        smtp_host = "smtp.gmail.com"
    if not smtp_host or not smtp_user or not smtp_pass:
        print(f"[KARETA] SMTP не настроен. Код для {target_email}: {code}")
        return
    msg = EmailMessage()
    msg["Subject"] = "Код подтверждения KARETA"
    msg["From"] = from_email
    msg["To"] = target_email
    msg.set_content(f"Ваш код подтверждения KARETA: {code}\nКод действует {CODE_TTL_MINUTES} минут.")
    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)


async def send_email(target_email: str, code: str) -> None:
    await asyncio.to_thread(_send_email_sync, target_email, code)


async def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                system_id TEXT UNIQUE,
                username TEXT UNIQUE,
                email TEXT NOT NULL UNIQUE,
                phone TEXT,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS verification_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                purpose TEXT NOT NULL DEFAULT 'register',
                secret_hash TEXT,
                code TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                sent_at TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS registration_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL,
                phone TEXT,
                password_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        await ensure_column(db, "users", "system_id", "TEXT")
        await ensure_column(db, "users", "username", "TEXT")
        await ensure_column(db, "users", "avatar", "TEXT")
        await ensure_column(db, "users", "public_key_spki", "TEXT")
        await ensure_column(db, "users", "first_name", "TEXT")
        await ensure_column(db, "users", "last_name", "TEXT")
        await ensure_column(db, "users", "bio", "TEXT")
        await ensure_column(db, "users", "show_avatar_non_contacts", "INTEGER NOT NULL DEFAULT 1")
        await ensure_column(db, "users", "show_name_non_contacts", "INTEGER NOT NULL DEFAULT 1")
        await ensure_column(db, "users", "username_changed_at", "TEXT")
        await ensure_column(db, "users", "privacy_avatar", "TEXT NOT NULL DEFAULT 'everyone'")
        await ensure_column(db, "users", "privacy_name", "TEXT NOT NULL DEFAULT 'everyone'")
        await ensure_column(db, "verification_codes", "purpose", "TEXT NOT NULL DEFAULT 'register'")
        await ensure_column(db, "verification_codes", "secret_hash", "TEXT")
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_system_id ON users(system_id)")
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)")
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_a_id INTEGER NOT NULL,
                user_b_id INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_a_id, user_b_id)
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                contact_user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, contact_user_id)
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS friend_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                from_user_id INTEGER NOT NULL,
                to_user_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                responded_at TEXT,
                UNIQUE(conversation_id, from_user_id, to_user_id, status)
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            )
            """
        )
        await db.execute("CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id)")
        await ensure_column(db, "messages", "iv", "TEXT")
        await ensure_column(db, "messages", "is_encrypted", "INTEGER NOT NULL DEFAULT 1")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id, status)")
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_read_states (
                conversation_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                last_read_message_id INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (conversation_id, user_id)
            )
            """
        )
        await db.execute(
            "UPDATE messages SET is_encrypted = 0 WHERE iv IS NULL OR TRIM(COALESCE(iv, '')) = ''"
        )
        await db.execute(
            "UPDATE users SET privacy_avatar = 'contacts' WHERE COALESCE(show_avatar_non_contacts, 1) = 0 AND privacy_avatar = 'everyone'"
        )
        await db.execute(
            "UPDATE users SET privacy_name = 'contacts' WHERE COALESCE(show_name_non_contacts, 1) = 0 AND privacy_name = 'everyone'"
        )
        await db.commit()


async def send_code_for_purpose(email: str, purpose: str, secret_hash: Optional[str] = None) -> None:
    now = utc_now()
    code = generate_code()
    expires = now + timedelta(minutes=CODE_TTL_MINUTES)
    async with aiosqlite.connect(DB_PATH) as db:
        last_cursor = await db.execute(
            """
            SELECT sent_at
            FROM verification_codes
            WHERE email = ? AND purpose = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (email, purpose),
        )
        row = await last_cursor.fetchone()
        if row is not None:
            elapsed = (now - iso_to_dt(row[0])).total_seconds()
            if elapsed < CODE_COOLDOWN_SECONDS:
                remaining = int(CODE_COOLDOWN_SECONDS - elapsed)
                raise HTTPException(
                    status_code=429,
                    detail=f"Подождите {remaining} сек. перед повторной отправкой кода.",
                )
        await db.execute("DELETE FROM verification_codes WHERE email = ? AND purpose = ?", (email, purpose))
        await db.execute(
            """
            INSERT INTO verification_codes (email, purpose, secret_hash, code, expires_at, sent_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (email, purpose, secret_hash, code, dt_to_iso(expires), dt_to_iso(now)),
        )
        await db.commit()
    await send_email(email, code)


async def validate_code(email: str, purpose: str, code: str, secret_hash: Optional[str] = None) -> None:
    now = utc_now()
    async with aiosqlite.connect(DB_PATH) as db:
        code_cursor = await db.execute(
            """
            SELECT code, expires_at, secret_hash
            FROM verification_codes
            WHERE email = ? AND purpose = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (email, purpose),
        )
        row = await code_cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="Для этого действия код еще не запрашивался.")
        saved_code, expires_at, saved_secret_hash = row
        if saved_code != code:
            raise HTTPException(status_code=400, detail="Неверный код подтверждения.")
        if iso_to_dt(expires_at) < now:
            raise HTTPException(status_code=400, detail="Срок действия кода истек.")
        if secret_hash is not None and saved_secret_hash != secret_hash:
            raise HTTPException(status_code=400, detail="Данные изменились. Запросите код заново.")
        await db.execute("DELETE FROM verification_codes WHERE email = ? AND purpose = ?", (email, purpose))
        await db.commit()


def normalize_pair(user_id_a: int, user_id_b: int) -> Tuple[int, int]:
    if user_id_a == user_id_b:
        raise HTTPException(status_code=400, detail="Нельзя открыть чат с самим собой.")
    return (min(user_id_a, user_id_b), max(user_id_a, user_id_b))


async def get_or_create_conversation(db: aiosqlite.Connection, user_id_a: int, user_id_b: int) -> int:
    a, b = normalize_pair(user_id_a, user_id_b)
    cur = await db.execute(
        "SELECT id FROM conversations WHERE user_a_id = ? AND user_b_id = ? LIMIT 1",
        (a, b),
    )
    row = await cur.fetchone()
    if row:
        return int(row[0])
    now = dt_to_iso(utc_now())
    await db.execute(
        "INSERT INTO conversations (user_a_id, user_b_id, updated_at) VALUES (?, ?, ?)",
        (a, b, now),
    )
    rid = await db.execute("SELECT last_insert_rowid()")
    new_id = await rid.fetchone()
    return int(new_id[0])


async def assert_conversation_member(db: aiosqlite.Connection, conversation_id: int, user_id: int) -> None:
    cur = await db.execute(
        "SELECT user_a_id, user_b_id FROM conversations WHERE id = ? LIMIT 1",
        (conversation_id,),
    )
    row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Чат не найден.")
    if user_id not in (row[0], row[1]):
        raise HTTPException(status_code=403, detail="Нет доступа к этому чату.")


async def is_contact(db: aiosqlite.Connection, user_id: int, target_user_id: int) -> bool:
    cur = await db.execute(
        "SELECT id FROM contacts WHERE user_id = ? AND contact_user_id = ? LIMIT 1",
        (user_id, target_user_id),
    )
    return (await cur.fetchone()) is not None


def build_peer_public_view(peer_row: tuple, as_contact: bool) -> dict:
    (
        user_id,
        system_id,
        username,
        email,
        phone,
        avatar,
        public_key_spki,
        first_name,
        last_name,
        bio,
        show_avatar,
        show_name,
        privacy_avatar,
        privacy_name,
    ) = peer_row
    pa = (privacy_avatar or "everyone").strip().lower()
    pn = (privacy_name or "everyone").strip().lower()
    if pa not in ("everyone", "contacts", "nobody"):
        pa = "contacts" if not bool(show_avatar) else "everyone"
    if pn not in ("everyone", "contacts", "nobody"):
        pn = "contacts" if not bool(show_name) else "everyone"

    if pa == "everyone":
        visible_avatar = avatar
    elif pa == "contacts":
        visible_avatar = avatar if as_contact else None
    else:
        visible_avatar = None

    if pn == "everyone":
        visible_first_name = first_name
        visible_last_name = last_name
        visible_bio = bio
    elif pn == "contacts":
        visible_first_name = first_name if as_contact else None
        visible_last_name = last_name if as_contact else None
        visible_bio = bio if as_contact else None
    else:
        visible_first_name = None
        visible_last_name = None
        visible_bio = None

    return {
        "id": user_id,
        "system_id": system_id if as_contact else None,
        "username": username,
        "email": email if as_contact else None,
        "phone": phone if as_contact else None,
        "avatar": visible_avatar,
        "public_key_spki": public_key_spki,
        "first_name": visible_first_name,
        "last_name": visible_last_name,
        "bio": visible_bio,
        "is_contact": as_contact,
    }


@app.on_event("startup")
async def startup_event() -> None:
    await init_db()


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.post("/api/auth/register/send-code")
async def register_send_code(payload: RegisterSendCodePayload):
    email = payload.email.lower()
    async with aiosqlite.connect(DB_PATH) as db:
        check = await db.execute("SELECT id FROM users WHERE email = ? LIMIT 1", (email,))
        if await check.fetchone():
            raise HTTPException(status_code=409, detail="Пользователь с такой почтой уже существует.")
    await send_code_for_purpose(email, "register")
    return {"message": "Код отправлен", "cooldown_seconds": CODE_COOLDOWN_SECONDS}


@app.post("/api/auth/register/verify")
async def register_verify(payload: RegisterVerifyPayload):
    email = payload.email.lower()
    async with aiosqlite.connect(DB_PATH) as db:
        check = await db.execute("SELECT id FROM users WHERE email = ? LIMIT 1", (email,))
        if await check.fetchone():
            raise HTTPException(status_code=409, detail="Пользователь с такой почтой уже существует.")
    await validate_code(email, "register", payload.code)
    token = generate_token()
    expires_at = utc_now() + timedelta(minutes=REGISTRATION_SESSION_TTL_MINUTES)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM registration_sessions WHERE email = ?", (email,))
        await db.execute(
            """
            INSERT INTO registration_sessions (token, email, phone, password_hash, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, email, payload.phone, hash_password(payload.password), dt_to_iso(expires_at)),
        )
        await db.commit()
    return {"message": "Код подтвержден", "registration_token": token}


@app.post("/api/auth/register/complete")
async def register_complete(payload: RegisterCompletePayload):
    now = utc_now()
    async with aiosqlite.connect(DB_PATH) as db:
        session_cursor = await db.execute(
            """
            SELECT email, phone, password_hash, expires_at
            FROM registration_sessions
            WHERE token = ?
            LIMIT 1
            """,
            (payload.registration_token,),
        )
        session_row = await session_cursor.fetchone()
        if session_row is None:
            raise HTTPException(status_code=400, detail="Некорректная сессия регистрации.")
        email, phone, password_hash, expires_at = session_row
        if iso_to_dt(expires_at) < now:
            await db.execute("DELETE FROM registration_sessions WHERE token = ?", (payload.registration_token,))
            await db.commit()
            raise HTTPException(status_code=400, detail="Сессия регистрации истекла.")
        username = f"@{payload.username_slug}"
        username_cursor = await db.execute("SELECT id FROM users WHERE username = ? LIMIT 1", (username,))
        if await username_cursor.fetchone():
            raise HTTPException(status_code=409, detail="Такой user_id уже занят.")
        email_cursor = await db.execute("SELECT id FROM users WHERE email = ? LIMIT 1", (email,))
        if await email_cursor.fetchone():
            raise HTTPException(status_code=409, detail="Пользователь с такой почтой уже существует.")
        system_id = await create_user_system_id(db)
        await db.execute(
            """
            INSERT INTO users (system_id, username, email, phone, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (system_id, username, email, phone, password_hash, dt_to_iso(now)),
        )
        await db.execute("DELETE FROM registration_sessions WHERE token = ?", (payload.registration_token,))
        id_cursor = await db.execute("SELECT last_insert_rowid()")
        user_row = await id_cursor.fetchone()
        user_id = int(user_row[0]) if user_row else 0
        await db.commit()
    session_token = await create_session_for_user(user_id)
    return {
        "message": "Регистрация завершена",
        "session_token": session_token,
        "user": {
            "email": email,
            "username": username,
            "system_id": system_id,
            "phone": phone,
            "avatar": None,
            "public_key_spki": None,
            "first_name": None,
            "last_name": None,
            "bio": None,
            "show_avatar_non_contacts": True,
            "show_name_non_contacts": True,
            "username_changed_at": None,
            "privacy_avatar": "everyone",
            "privacy_name": "everyone",
        },
    }


@app.post("/api/auth/login/send-code")
async def login_send_code(payload: LoginSendCodePayload):
    email = payload.email.lower()
    password_hash = hash_password(payload.password)
    async with aiosqlite.connect(DB_PATH) as db:
        check = await db.execute(
            "SELECT id FROM users WHERE email = ? AND password_hash = ? LIMIT 1",
            (email, password_hash),
        )
        if await check.fetchone() is None:
            raise HTTPException(status_code=401, detail="Неверная почта или пароль.")
    await send_code_for_purpose(email, "login", password_hash)
    return {"message": "Код отправлен", "cooldown_seconds": CODE_COOLDOWN_SECONDS}


@app.post("/api/auth/login/verify")
async def login_verify(payload: LoginVerifyPayload):
    email = payload.email.lower()
    password_hash = hash_password(payload.password)
    await validate_code(email, "login", payload.code, password_hash)
    async with aiosqlite.connect(DB_PATH) as db:
        user_cursor = await db.execute(
            """
            SELECT
                id,
                system_id,
                username,
                email,
                phone,
                avatar,
                public_key_spki,
                first_name,
                last_name,
                bio,
                show_avatar_non_contacts,
                show_name_non_contacts,
                username_changed_at,
                privacy_avatar,
                privacy_name
            FROM users
            WHERE email = ? AND password_hash = ?
            LIMIT 1
            """,
            (email, password_hash),
        )
        row = await user_cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Неверная почта или пароль.")
    (
        user_id,
        system_id,
        username,
        user_email,
        phone,
        avatar,
        public_key_spki,
        first_name,
        last_name,
        bio,
        show_avatar,
        show_name,
        username_changed_at,
        privacy_avatar,
        privacy_name,
    ) = row
    session_token = await create_session_for_user(int(user_id))
    return {
        "message": "Вход выполнен",
        "session_token": session_token,
        "user": {
            "email": user_email,
            "username": username,
            "system_id": system_id,
            "phone": phone,
            "avatar": avatar,
            "public_key_spki": public_key_spki,
            "first_name": first_name,
            "last_name": last_name,
            "bio": bio,
            "show_avatar_non_contacts": bool(show_avatar) if show_avatar is not None else True,
            "show_name_non_contacts": bool(show_name) if show_name is not None else True,
            "username_changed_at": username_changed_at,
            "privacy_avatar": privacy_avatar or "everyone",
            "privacy_name": privacy_name or "everyone",
        },
    }


@app.post("/api/auth/delete/send-code")
async def delete_send_code(payload: DeleteSendCodePayload):
    email = payload.email.lower()
    password_hash = hash_password(payload.password)
    async with aiosqlite.connect(DB_PATH) as db:
        check = await db.execute(
            "SELECT id FROM users WHERE email = ? AND password_hash = ? LIMIT 1",
            (email, password_hash),
        )
        if await check.fetchone() is None:
            raise HTTPException(status_code=401, detail="Неверная почта или пароль.")
    await send_code_for_purpose(email, "delete", password_hash)
    return {"message": "Код отправлен", "cooldown_seconds": CODE_COOLDOWN_SECONDS}


@app.post("/api/auth/delete/confirm")
async def delete_confirm(payload: DeleteConfirmPayload):
    email = payload.email.lower()
    password_hash = hash_password(payload.password)
    await validate_code(email, "delete", payload.code, password_hash)
    async with aiosqlite.connect(DB_PATH) as db:
        check = await db.execute(
            "SELECT id FROM users WHERE email = ? AND password_hash = ? LIMIT 1",
            (email, password_hash),
        )
        user_row = await check.fetchone()
        if user_row is None:
            raise HTTPException(status_code=401, detail="Неверная почта или пароль.")
        uid = int(user_row[0])
        await db.execute(
            "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_a_id = ? OR user_b_id = ?)",
            (uid, uid),
        )
        await db.execute("DELETE FROM conversations WHERE user_a_id = ? OR user_b_id = ?", (uid, uid))
        await db.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        await db.execute("DELETE FROM users WHERE id = ?", (uid,))
        await db.execute("DELETE FROM verification_codes WHERE email = ?", (email,))
        await db.execute("DELETE FROM registration_sessions WHERE email = ?", (email,))
        await db.commit()
    return {"message": "Аккаунт удален"}


@app.get("/api/me")
async def read_me(current_user: dict = Depends(get_current_user)):
    return {"user": public_user(current_user)}


@app.patch("/api/me")
async def update_me(payload: ProfileUpdatePayload, current_user: dict = Depends(get_current_user)):
    if (
        payload.avatar is None
        and payload.username_slug is None
        and payload.email is None
        and payload.phone is None
        and payload.first_name is None
        and payload.last_name is None
        and payload.bio is None
        and payload.show_avatar_non_contacts is None
        and payload.show_name_non_contacts is None
        and payload.privacy_avatar is None
        and payload.privacy_name is None
    ):
        raise HTTPException(status_code=400, detail="Нет данных для обновления.")

    updates = {}
    now = utc_now()
    if payload.username_slug is not None:
        next_username = f"@{payload.username_slug}"
        current_un = (current_user.get("username") or "").strip().lower()
        if next_username.lower() != current_un:
            last_changed = current_user.get("username_changed_at")
            if last_changed:
                dt = iso_to_dt(last_changed)
                if dt + timedelta(days=1) > now:
                    remain = int((dt + timedelta(days=1) - now).total_seconds() // 3600) + 1
                    raise HTTPException(
                        status_code=429,
                        detail=f"user_id можно менять раз в сутки. Осталось ~{remain} ч.",
                    )
            updates["username"] = next_username
            updates["username_changed_at"] = dt_to_iso(now)

    if payload.email is not None:
        updates["email"] = payload.email.lower()
    if payload.phone is not None:
        updates["phone"] = payload.phone
    if payload.first_name is not None:
        updates["first_name"] = payload.first_name
    if payload.last_name is not None:
        updates["last_name"] = payload.last_name
    if payload.bio is not None:
        updates["bio"] = payload.bio
    if payload.avatar is not None:
        updates["avatar"] = payload.avatar
    if payload.show_avatar_non_contacts is not None:
        updates["show_avatar_non_contacts"] = 1 if payload.show_avatar_non_contacts else 0
    if payload.show_name_non_contacts is not None:
        updates["show_name_non_contacts"] = 1 if payload.show_name_non_contacts else 0
    if payload.privacy_avatar is not None:
        updates["privacy_avatar"] = payload.privacy_avatar
        updates["show_avatar_non_contacts"] = 1 if payload.privacy_avatar == "everyone" else 0
    if payload.privacy_name is not None:
        updates["privacy_name"] = payload.privacy_name
        updates["show_name_non_contacts"] = 1 if payload.privacy_name == "everyone" else 0

    async with aiosqlite.connect(DB_PATH) as db:
        if "username" in updates:
            chk = await db.execute(
                "SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1",
                (updates["username"], current_user["id"]),
            )
            if await chk.fetchone():
                raise HTTPException(status_code=409, detail="Такой user_id уже занят.")
        if "email" in updates:
            chk = await db.execute(
                "SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1",
                (updates["email"], current_user["id"]),
            )
            if await chk.fetchone():
                raise HTTPException(status_code=409, detail="Почта уже занята.")
        if "phone" in updates and updates["phone"]:
            chk = await db.execute(
                "SELECT id FROM users WHERE phone = ? AND id != ? LIMIT 1",
                (updates["phone"], current_user["id"]),
            )
            if await chk.fetchone():
                raise HTTPException(status_code=409, detail="Телефон уже занят.")
        set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values()) + [current_user["id"]]
        await db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
        cur = await db.execute(
            """
            SELECT id, system_id, username, email, phone, avatar, public_key_spki,
                   first_name, last_name, bio, show_avatar_non_contacts, show_name_non_contacts,
                   username_changed_at, privacy_avatar, privacy_name
            FROM users WHERE id = ? LIMIT 1
            """,
            (current_user["id"],),
        )
        row = await cur.fetchone()
        await db.commit()
    fresh = {
        "id": row[0],
        "system_id": row[1],
        "username": row[2],
        "email": row[3],
        "phone": row[4],
        "avatar": row[5],
        "public_key_spki": row[6],
        "first_name": row[7],
        "last_name": row[8],
        "bio": row[9],
        "show_avatar_non_contacts": bool(row[10]) if row[10] is not None else True,
        "show_name_non_contacts": bool(row[11]) if row[11] is not None else True,
        "username_changed_at": row[12],
        "privacy_avatar": row[13] or "everyone",
        "privacy_name": row[14] or "everyone",
    }
    return {"message": "Сохранено", "user": public_user(fresh)}


@app.post("/api/me/public-key")
async def upload_public_key(payload: PublicKeyPayload, current_user: dict = Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET public_key_spki = ? WHERE id = ?",
            (payload.public_key_spki_b64, current_user["id"]),
        )
        await db.commit()
    return {
        "message": "Ключ сохранён",
        "user": public_user({**current_user, "public_key_spki": payload.public_key_spki_b64}),
    }


@app.get("/api/users/search")
async def search_users(q: str = "", current_user: dict = Depends(get_current_user)):
    term = q.strip().lower()
    if term.startswith("@"):
        term = term[1:]
    if len(term) < 1:
        return {"users": []}
    like = f"%{term}%"
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            SELECT id, system_id, username, email, phone, avatar, public_key_spki,
                   first_name, last_name, bio, show_avatar_non_contacts, show_name_non_contacts,
                   privacy_avatar, privacy_name
            FROM users
            WHERE id != ? AND LOWER(username) LIKE ?
            LIMIT 30
            """,
            (current_user["id"], like),
        )
        rows = await cur.fetchall()
    return {
        "users": [public_user(build_peer_public_view(r, False)) for r in rows]
    }


@app.get("/api/chats")
async def list_chats(current_user: dict = Depends(get_current_user)):
    uid = int(current_user["id"])
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            SELECT c.id, c.user_a_id, c.user_b_id, c.updated_at
            FROM conversations c
            WHERE c.user_a_id = ? OR c.user_b_id = ?
            ORDER BY c.updated_at DESC
            """,
            (uid, uid),
        )
        rows = await cur.fetchall()
    chats = []
    for cid, ua, ub, updated_at in rows:
        peer_id = ub if ua == uid else ua
        async with aiosqlite.connect(DB_PATH) as db:
            uc = await db.execute(
                """
                SELECT id, system_id, username, email, phone, avatar, public_key_spki,
                       first_name, last_name, bio, show_avatar_non_contacts, show_name_non_contacts,
                       privacy_avatar, privacy_name
                FROM users
                WHERE id = ? LIMIT 1
                """,
                (peer_id,),
            )
            peer_row = await uc.fetchone()
            if not peer_row:
                continue
            contact_state = await is_contact(db, uid, peer_id)
            mc = await db.execute(
                """
                SELECT body, created_at, is_encrypted FROM messages
                WHERE conversation_id = ?
                ORDER BY created_at DESC LIMIT 1
                """,
                (cid,),
            )
            last = await mc.fetchone()
        last_preview = None
        if last and not last[2]:
            last_preview = last[0]
        chats.append(
            {
                "id": cid,
                "peer": public_user(build_peer_public_view(peer_row, contact_state)),
                "last_message": last_preview,
                "last_message_encrypted": bool(last and last[2]),
                "updated_at": updated_at,
            }
        )
    return {"chats": chats}


@app.post("/api/chats/open")
async def open_chat(payload: OpenChatPayload, current_user: dict = Depends(get_current_user)):
    uid = int(current_user["id"])
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            SELECT id, system_id, username, email, phone, avatar, public_key_spki,
                   first_name, last_name, bio, show_avatar_non_contacts, show_name_non_contacts,
                   privacy_avatar, privacy_name
            FROM users
            WHERE username = ? LIMIT 1
            """,
            (payload.peer_username,),
        )
        peer_row = await cur.fetchone()
        if peer_row is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден.")
        peer_id = int(peer_row[0])
        if peer_id == uid:
            raise HTTPException(status_code=400, detail="Нельзя открыть чат с самим собой.")
        cid = await get_or_create_conversation(db, uid, peer_id)
        await db.commit()
    async with aiosqlite.connect(DB_PATH) as db:
        contact_state = await is_contact(db, uid, peer_id)
    peer = build_peer_public_view(peer_row, contact_state)
    return {"conversation_id": cid, "peer": public_user(peer)}


@app.get("/api/chats/{conversation_id}/messages")
async def get_messages(
    conversation_id: int,
    current_user: dict = Depends(get_current_user),
):
    uid = int(current_user["id"])
    async with aiosqlite.connect(DB_PATH) as db:
        await assert_conversation_member(db, conversation_id, uid)
        ccur = await db.execute("SELECT user_a_id, user_b_id FROM conversations WHERE id = ? LIMIT 1", (conversation_id,))
        crow = await ccur.fetchone()
        peer_id = crow[1] if crow and crow[0] == uid else (crow[0] if crow else None)
        cur = await db.execute(
            """
            SELECT m.id, m.sender_id, m.body, m.created_at, u.username, m.iv, m.is_encrypted
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at ASC
            LIMIT 500
            """,
            (conversation_id,),
        )
        rows = await cur.fetchall()
        pr_cur = await db.execute(
            """
            SELECT last_read_message_id FROM chat_read_states
            WHERE conversation_id = ? AND user_id = ?
            LIMIT 1
            """,
            (conversation_id, peer_id),
        )
        pr_row = await pr_cur.fetchone()
        peer_last_read = int(pr_row[0]) if pr_row and pr_row[0] is not None else 0
        req_cur = await db.execute(
            """
            SELECT id, from_user_id, created_at
            FROM friend_requests
            WHERE conversation_id = ? AND to_user_id = ? AND status = 'pending'
            ORDER BY id DESC LIMIT 1
            """,
            (conversation_id, uid),
        )
        req_row = await req_cur.fetchone()
    return {
        "messages": [
            {
                "id": r[0],
                "sender_id": r[1],
                "body": r[2] if not r[6] else None,
                "created_at": r[3],
                "sender_username": r[4],
                "mine": r[1] == uid,
                "is_encrypted": bool(r[6]),
                "iv_b64": r[5],
                "ciphertext_b64": r[2] if r[6] else None,
                "read_by_peer": (r[1] == uid and peer_last_read >= int(r[0])),
            }
            for r in rows
        ],
        "peer_last_read_message_id": peer_last_read,
        "incoming_request": (
            {"id": req_row[0], "from_user_id": req_row[1], "created_at": req_row[2]} if req_row else None
        ),
        "peer_id": peer_id,
    }


@app.post("/api/chats/{conversation_id}/read")
async def mark_chat_read(conversation_id: int, current_user: dict = Depends(get_current_user)):
    uid = int(current_user["id"])
    async with aiosqlite.connect(DB_PATH) as db:
        await assert_conversation_member(db, conversation_id, uid)
        mx = await db.execute(
            "SELECT MAX(id) FROM messages WHERE conversation_id = ?",
            (conversation_id,),
        )
        mx_row = await mx.fetchone()
        max_id = int(mx_row[0]) if mx_row and mx_row[0] is not None else 0
        await db.execute(
            """
            INSERT INTO chat_read_states (conversation_id, user_id, last_read_message_id)
            VALUES (?, ?, ?)
            ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id
            """,
            (conversation_id, uid, max_id),
        )
        await db.commit()
    return {"message": "Прочитано", "last_read_message_id": max_id}


@app.post("/api/chats/{conversation_id}/messages")
async def post_message(
    conversation_id: int,
    payload: EncryptedMessagePayload,
    current_user: dict = Depends(get_current_user),
):
    uid = int(current_user["id"])
    now = dt_to_iso(utc_now())
    async with aiosqlite.connect(DB_PATH) as db:
        await assert_conversation_member(db, conversation_id, uid)
        await db.execute(
            """
            INSERT INTO messages (conversation_id, sender_id, body, iv, is_encrypted, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
            """,
            (conversation_id, uid, payload.ciphertext_b64, payload.iv_b64, now),
        )
        await db.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (now, conversation_id),
        )
        await db.commit()
    return {"message": "Отправлено", "created_at": now}


@app.get("/api/chats/{conversation_id}/peer-profile")
async def get_peer_profile(conversation_id: int, current_user: dict = Depends(get_current_user)):
    uid = int(current_user["id"])
    async with aiosqlite.connect(DB_PATH) as db:
        await assert_conversation_member(db, conversation_id, uid)
        ccur = await db.execute("SELECT user_a_id, user_b_id FROM conversations WHERE id = ? LIMIT 1", (conversation_id,))
        crow = await ccur.fetchone()
        peer_id = crow[1] if crow and crow[0] == uid else crow[0]
        pcur = await db.execute(
            """
            SELECT id, system_id, username, email, phone, avatar, public_key_spki,
                   first_name, last_name, bio, show_avatar_non_contacts, show_name_non_contacts,
                   privacy_avatar, privacy_name
            FROM users WHERE id = ? LIMIT 1
            """,
            (peer_id,),
        )
        prow = await pcur.fetchone()
        if not prow:
            raise HTTPException(status_code=404, detail="Пользователь не найден.")
        contact_state = await is_contact(db, uid, peer_id)
    return {"peer": public_user(build_peer_public_view(prow, contact_state))}


@app.post("/api/chats/{conversation_id}/friend-request")
async def send_friend_request(conversation_id: int, current_user: dict = Depends(get_current_user)):
    uid = int(current_user["id"])
    now = dt_to_iso(utc_now())
    async with aiosqlite.connect(DB_PATH) as db:
        await assert_conversation_member(db, conversation_id, uid)
        ccur = await db.execute("SELECT user_a_id, user_b_id FROM conversations WHERE id = ? LIMIT 1", (conversation_id,))
        crow = await ccur.fetchone()
        to_user_id = crow[1] if crow and crow[0] == uid else crow[0]
        if await is_contact(db, uid, to_user_id):
            return {"message": "Вы уже в контактах."}
        chk = await db.execute(
            """
            SELECT id FROM friend_requests
            WHERE conversation_id = ? AND from_user_id = ? AND to_user_id = ? AND status = 'pending'
            LIMIT 1
            """,
            (conversation_id, uid, to_user_id),
        )
        if await chk.fetchone():
            return {"message": "Запрос уже отправлен."}
        await db.execute(
            """
            INSERT INTO friend_requests (conversation_id, from_user_id, to_user_id, status, created_at)
            VALUES (?, ?, ?, 'pending', ?)
            """,
            (conversation_id, uid, to_user_id, now),
        )
        await db.commit()
    return {"message": "Запрос отправлен."}


@app.post("/api/friend-requests/{request_id}/accept")
async def accept_friend_request(request_id: int, current_user: dict = Depends(get_current_user)):
    uid = int(current_user["id"])
    now = dt_to_iso(utc_now())
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            SELECT from_user_id, to_user_id, status
            FROM friend_requests
            WHERE id = ?
            LIMIT 1
            """,
            (request_id,),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Запрос не найден.")
        from_user_id, to_user_id, status = int(row[0]), int(row[1]), row[2]
        if to_user_id != uid:
            raise HTTPException(status_code=403, detail="Нет доступа к запросу.")
        if status != "pending":
            return {"message": "Запрос уже обработан."}
        await db.execute(
            "UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?",
            (now, request_id),
        )
        await db.execute(
            "INSERT OR IGNORE INTO contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)",
            (from_user_id, to_user_id, now),
        )
        await db.execute(
            "INSERT OR IGNORE INTO contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)",
            (to_user_id, from_user_id, now),
        )
        await db.commit()
    return {"message": "Запрос принят."}


@app.get("/api/contacts")
async def list_contacts(current_user: dict = Depends(get_current_user)):
    uid = int(current_user["id"])
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            SELECT u.id, u.system_id, u.username, u.email, u.phone, u.avatar, u.public_key_spki,
                   u.first_name, u.last_name, u.bio, u.show_avatar_non_contacts, u.show_name_non_contacts,
                   u.privacy_avatar, u.privacy_name
            FROM contacts c
            JOIN users u ON u.id = c.contact_user_id
            WHERE c.user_id = ?
            ORDER BY c.id DESC
            """,
            (uid,),
        )
        rows = await cur.fetchall()
    return {"contacts": [public_user(build_peer_public_view(r, True)) for r in rows]}


@app.delete("/api/auth/session")
async def logout_session(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Требуется авторизация.")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM sessions WHERE token = ?", (credentials.credentials,))
        await db.commit()
    return {"message": "Выход выполнен"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
