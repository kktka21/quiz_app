# Техническое Задание: Мультиплеерная викторина (QuizBattle)

**Срок реализации** - 3 месяца 

**Команда** - 2 разработчика

---

## Содержание

1. [Описание проекта](#1-описание-проекта)
2. [Роли пользователей](#2-роли-пользователей)
3. [Функциональные требования](#3-функциональные-требования)
4. [Технический стек](#4-технический-стек)
5. [Архитектура и модель данных](#5-архитектура-и-модель-данных)
6. [API Endpoints](#6-api-endpoints)
7. [WebSocket Events](#7-websocket-events)
8. [Распределение задач](#8-распределение-задач)
9. [Критерии приемки](#9-критерии-приемки)
10. [Таймлайн](#10-таймлайн)

---

## 1. Описание проекта

Веб-приложение для проведения интеллектуальных викторин в реальном времени. Пользователи создают комнаты, приглашают друзей и соревнуются в знаниях.

### Основные возможности

- Создание и участие в игровых комнатах
- Real-time игровой процесс с синхронизацией
- Система подсчета очков (правильность + скорость)
- Личная статистика и глобальный рейтинг
- База вопросов с категориями

---

## 2. Роли пользователей

| Роль | Возможности |
|------|-------------|
| **Гость** | Просмотр главной страницы, правил |
| **Игрок** | Регистрация, вход, создание комнат, участие в играх, статистика, лидерборд |
| **Хост** | Настройка комнаты, запуск игры, управление игроками |
| **Админ** | Управление вопросами, просмотр статистики, модерация |

---

## 3. Функциональные требования

### 3.1. Авторизация и профиль

**Регистрация/вход:**
- По email/паролю
- JWT токены
- Валидация данных

**Профиль:**
- Аватар (генерация по умолчанию)
- Никнейм
- Дата регистрации

**Статистика игрока:**
- Всего игр
- Побед
- Процент правильных ответов
- Общий рейтинг

### 3.2. Комнаты (лобби)

**Создание комнаты:**
- Название
- Тип доступа: публичная / приватная (по коду)
- Максимум игроков (2-8)
- Количество вопросов (5, 10, 15)
- Категория (Наука, История, Спорт, Кино, Микс)
- Время на ответ (10, 20, 30 сек)

**Список комнат:**
- Публичные комнаты
- Поиск по названию
- Фильтр по статусу

**Лобби комнаты:**
- Список игроков с аватарками
- Индикаторы готовности
- Чат комнаты
- Кнопка старта (только для Host)

### 3.3. Игровой процесс

**Этапы:**

1. **Обратный отсчет** (3 сек)
2. **Раунд** (повторяется N раз):
   - Отображение вопроса и 4 вариантов ответа
   - Таймер с визуальным прогресс-баром
   - Игрок выбирает ответ → кнопки блокируются
   - Сервер начисляет очки (формула ниже)
   - Показ правильного ответа и очков за раунд (3 сек)

3. **Завершение:**
   - Финальная таблица с результатами
   - Кнопки: "Играть снова", "В лобби", "На главную"

**Формула очков:**
```
Правильный ответ: 100 + (оставшееся время / макс. время) × 50
Неправильный ответ: 0
```

### 3.4. Лидерборд

- Топ-100 игроков по сумме очков
- Отображение места текущего пользователя
- Сортировка по:
  - Общему рейтингу
  - Количеству побед
  - Проценту правильных ответов

### 3.5. База вопросов

**Структура:**
- Текст вопроса
- 4 варианта ответа
- Правильный ответ (0-3)
- Категория
- Сложность (easy, medium, hard)

**Наполнение:** минимум 100 вопросов при старте

**Админка:** CRUD для вопросов

---

## 4. Технический стек

| Компонент | Технология |
|-----------|------------|
| **Frontend** | React + TypeScript + Vite |
| **UI** | Material UI / Chakra UI |
| **State** | Zustand |
| **Backend** | Node.js + Express.js + TypeScript |
| **Real-time** | Socket.io |
| **Database** | PostgreSQL |
| **Cache** | Redis |
| **ORM** | Prisma |
| **Docker** | Docker + Docker Compose |

---

## 5. Архитектура и модель данных

### 5.1. Схема базы данных

```sql
-- Пользователи
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_score INTEGER DEFAULT 0,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  correct_answers INTEGER DEFAULT 0
);

-- Категории
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);

-- Вопросы
CREATE TABLE questions (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_answer INTEGER NOT NULL CHECK (correct_answer BETWEEN 0 AND 3),
  category_id INTEGER REFERENCES categories(id),
  difficulty VARCHAR(10) CHECK (difficulty IN ('easy', 'medium', 'hard'))
);

-- Комнаты
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  host_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'waiting',
  settings JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Игроки в комнате
CREATE TABLE room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_ready BOOLEAN DEFAULT false,
  score INTEGER DEFAULT 0,
  UNIQUE(room_id, user_id)
);

-- История игр
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id),
  winner_id UUID REFERENCES users(id),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP
);

-- Ответы
CREATE TABLE game_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  question_id INTEGER REFERENCES questions(id),
  answer INTEGER CHECK (answer BETWEEN 0 AND 3),
  is_correct BOOLEAN,
  time_spent INTEGER,
  points_earned INTEGER
);

-- Лидерборд (материализованное представление)
CREATE MATERIALIZED VIEW leaderboard AS
SELECT 
  u.id,
  u.nickname,
  u.avatar_url,
  ROW_NUMBER() OVER (ORDER BY u.total_score DESC) as rank,
  u.total_score,
  u.wins,
  CASE 
    WHEN u.games_played > 0 
    THEN (u.correct_answers::float / (u.games_played * 10) * 100)
    ELSE 0 
  END as accuracy
FROM users u
WHERE u.games_played > 0
ORDER BY u.total_score DESC
LIMIT 100;
```

### 5.2. Redis структуры

```
# Состояние комнаты
room:{roomId} -> hash {
  status: "waiting|playing",
  currentQuestion: index,
  questionStartTime: timestamp,
  players: count
}

# Очки игроков
room:{roomId}:scores -> hash {
  userId: score
}

# Ответы за раунд
room:{roomId}:answers:{questionId} -> list [
  {userId, answer, timeSpent}
]

# Таймеры
timer:{roomId} -> string (время окончания)
```

---

## 6. API Endpoints

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| POST | `/api/auth/register` | Регистрация |
| POST | `/api/auth/login` | Вход |
| GET | `/api/users/:id` | Профиль |
| GET | `/api/users/:id/stats` | Статистика |
| POST | `/api/rooms` | Создать комнату |
| GET | `/api/rooms` | Список комнат |
| GET | `/api/rooms/:id` | Информация о комнате |
| POST | `/api/rooms/:code/join` | Присоединиться |
| GET | `/api/leaderboard` | Лидерборд |
| GET | `/api/categories` | Категории |
| POST | `/api/admin/questions` | Добавить вопрос (admin) |
| PUT | `/api/admin/questions/:id` | Изменить вопрос |
| DELETE | `/api/admin/questions/:id` | Удалить вопрос |

---

## 7. WebSocket Events

**Пространство имен:** `/game`

### Клиент → Сервер

| Событие | Данные |
|---------|--------|
| `join_room` | `{ roomId, userId }` |
| `player_ready` | `{ roomId, isReady }` |
| `start_game` | `{ roomId }` |
| `submit_answer` | `{ roomId, questionId, answerIndex, timeSpent }` |
| `chat_message` | `{ roomId, message }` |

### Сервер → Клиент

| Событие | Данные |
|---------|--------|
| `room_state` | `{ players, settings }` |
| `player_joined` | `{ user, players }` |
| `player_left` | `{ userId, players }` |
| `game_starting` | `{ countdown }` |
| `new_question` | `{ text, options, timeLimit, current, total }` |
| `answer_result` | `{ isCorrect, pointsEarned, correctAnswer }` |
| `round_summary` | `{ correctAnswer, results }` |
| `game_over` | `{ results, winner }` |
| `chat_message` | `{ userId, nickname, message, timestamp }` |

---

## 8. Распределение задач

### Разработчик 1 (Backend)

| Неделя | Задачи |
|--------|--------|
| 1 | Настройка проекта, Docker, PostgreSQL, Prisma |
| 2-3 | Auth, JWT, профили, статистика |
| 4-5 | CRUD комнат, категорий, вопросов |
| 6-7 | WebSocket, игровая логика, подсчет очков |
| 8 | Redis, кэширование, лидерборд |
| 9-10 | Админка (API), тестирование, документация |
| 11-12 | Безопасность, оптимизация, багфиксы |

### Разработчик 2 (Frontend)

| Неделя | Задачи |
|--------|--------|
| 1 | Настройка React, Vite, TypeScript, UI библиотека |
| 2-3 | Роутинг, страница авторизации, профиль |
| 4-5 | Создание комнаты, список комнат, лобби, чат |
| 6-7 | Игровой экран, таймер, анимации |
| 8 | Результаты, лидерборд, статистика |
| 9-10 | Интеграция с WebSocket, оптимизация |
| 11-12 | Адаптивность, тестирование, багфиксы |

### Совместные задачи

| Неделя | Задача |
|--------|--------|
| 1 | Согласование API контрактов |
| 4-5 | Интеграция создания комнаты |
| 7 | Полный игровой цикл |
| 10 | Code review |
| 12 | Деплой, демо |

---

## 9. Критерии приемки

### Функциональность

- [ ] Регистрация и вход работают
- [ ] Создание комнаты с настройками
- [ ] Присоединение по коду или из списка
- [ ] Лобби показывает игроков и статус готовности
- [ ] Игра запускается (Host)
- [ ] Вопросы и варианты отображаются корректно
- [ ] Таймер синхронизирован
- [ ] Очки начисляются по формуле
- [ ] После раунда виден правильный ответ
- [ ] Финальная таблица результатов
- [ ] Статистика сохраняется в профиль
- [ ] Лидерборд показывает топ игроков
- [ ] Админ может управлять вопросами

### Качество

- [ ] TypeScript strict mode
- [ ] Нет console.log в production
- [ ] Обработка ошибок на клиенте и сервере
- [ ] Валидация входных данных
- [ ] Защита от множественных ответов

### Документация

- [ ] README с инструкцией по запуску
- [ ] .env.example
- [ ] Swagger/OpenAPI документация

---

## 10. Таймлайн (12 недель)

| Неделя | Разработчик 1 | Разработчик 2 |
|--------|---------------|---------------|
| 1 | Инфраструктура, Docker, БД | Настройка React, Vite, UI |
| 2 | Auth, JWT | Авторизация, регистрация |
| 3 | Профили, статистика | Профиль, статистика |
| 4 | CRUD комнат, категорий | Создание комнаты, список комнат |
| 5 | Вопросы, админка API | Лобби, чат |
| 6 | WebSocket база | Интеграция WS в лобби |
| 7 | Игровая логика | Игровой экран, таймер |
| 8 | Подсчет очков, Redis | Анимации, результаты |
| 9 | Лидерборд, кэширование | Лидерборд, статистика |
| 10 | Тестирование, оптимизация | Интеграция, оптимизация |
| 11 | Безопасность, багфиксы | Адаптивность, багфиксы |
| 12 | Документация, деплой | Полировка, деплой |

---

## Приложение: Пример вопроса

```json
{
  "id": 1,
  "text": "Сколько планет в Солнечной системе?",
  "options": ["7", "8", "9", "10"],
  "correctAnswer": 1,
  "category": "Наука",
  "difficulty": "easy"
}
```

## Приложение: Подсчет очков

```typescript
function calculatePoints(
  isCorrect: boolean,
  timeLeft: number,
  maxTime: number
): number {
  if (!isCorrect) return 0;
  const speedBonus = (timeLeft / maxTime) * 50;
  return Math.round(100 + speedBonus);
}
```
