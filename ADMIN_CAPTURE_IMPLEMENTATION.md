# Admin-Focused Frontend Capture — Implementation Summary

## 🎯 Цель
Поддержка захвата и анализа админ-панелей (как https://kort.up.railway.app) с авторизацией, фильтрацией ресурсов, исключениями путей и глубиной обхода.

---

## ✅ Что реализовано

### 1️⃣ Login Session Capture (`/api/auth-session`)
**Файл:** `apps/api/src/capture/loginCapture.ts`

Новый endpoint для автоматического прохождения процесса авторизации:

```typescript
POST /api/auth-session
{
  "actions": [
    { "type": "goto", "url": "https://kort.up.railway.app/login" },
    { "type": "fill", "selector": "input[email]", "value": "admin@kort.local" },
    { "type": "fill", "selector": "input[password]", "value": "demo1234" },
    { "type": "click", "selector": "button[submit]", "waitMs": 2000 },
    { "type": "wait", "selector": ".dashboard", "timeoutMs": 5000 }
  ],
  "timeoutMs": 60000
}
```

**Результат:**
```json
{
  "sourceUrl": "https://kort.up.railway.app/dashboard",
  "cookies": [...],
  "storages": [
    {
      "origin": "https://kort.up.railway.app",
      "localStorage": {...},
      "sessionStorage": {...}
    }
  ]
}
```

**Поддерживаемые действия:**
- `goto` — переход на URL
- `fill` — заполнение инпута значением
- `click` — клик на элемент
- `wait` — ожидание элемента
- `screenshot` — скриншот текущего состояния

---

### 2️⃣ Domain Filters
**Файл:** `apps/api/src/capture/captureSite.ts` (функция `matchesDomainFilter`)

Фильтрация ресурсов по доменам при захвате:

```json
POST /api/capture
{
  "url": "https://kort.up.railway.app/dashboard",
  "domainFilter": {
    "include": ["kort.up.railway.app"],
    "exclude": ["google-analytics.com", "cdn.*.com", "*.sentry.io"]
  }
}
```

**Логика:**
- Если `include` есть → сохраняются ТОЛЬКО ресурсы из этих доменов
- Если `exclude` есть → исключаются ресурсы из этих доменов
- Поддерживает wildcards: `*.example.com`

---

### 3️⃣ Path Exclusions
**Файл:** `apps/api/src/capture/safeInteractions.ts` (функция `shouldSkipPath`)

Пропуск опасных путей при выполнении интеракций:

```json
POST /api/capture
{
  "url": "https://kort.up.railway.app/dashboard",
  "pathExclusions": ["/logout", "/api/delete", "/api/purge", "/admin/reset"]
}
```

**Логика:**
- Если текущий URL содержит любой из исключённых путей → интеракции пропускаются
- Защита от случайного логаута или удаления

---

### 4️⃣ Crawl Depth
**Файл:** `apps/api/src/capture/safeInteractions.ts` (переменные `currentDepth`, `visitedUrls`)

Ограничение глубины обхода страниц:

```json
POST /api/capture
{
  "url": "https://kort.up.railway.app/dashboard",
  "crawlDepth": 3
}
```

**Логика:**
- Отслеживает уникальные URL, посещённые при навигации
- Считает глубину по переходам между страницами
- Останавливает интеракции при достижении лимита

**Рекомендуемые значения:**
- `1` — только стартовая страница
- `2-3` — небольшое количество страниц (для админ-панелей)
- `5+` — глубокий обход сайта

---

### 5️⃣ Admin Mode
**Файл:** `apps/api/src/capture/safeInteractions.ts` (константа `ADMIN_SELECTORS`)

Специальный режим для работы с админ-панелями:

```json
POST /api/capture
{
  "url": "https://kort.up.railway.app/dashboard",
  "adminMode": true
}
```

**В режиме Admin Mode:**
- Дополнительные селекторы для таблиц: `table button`, `[role='tab']`, `[role='menuitem']`
- Селекторы для модальных окон: `.modal button`
- Более агрессивные интеракции: `input[checkbox]`, `input[radio]`
- Индивидуальные `data-testid` атрибуты
- Не требует `isSafeLabel()` валидации для всех элементов
- Сканирует больше элементов (200 вместо 120)

---

### 6️⃣ Extended Capture Options
**Файл:** `apps/api/src/capture/types.ts`

```typescript
export type CaptureOptions = {
  url: string;
  maxActionsPerPage: number;
  timeoutMs: number;
  session?: ImportedSessionSnapshot;
  domainFilter?: DomainFilter;        // NEW
  pathExclusions?: string[];           // NEW
  crawlDepth?: number;                 // NEW
  adminMode?: boolean;                 // NEW
};
```

---

### 7️⃣ UI Configuration Component
**Файл:** `apps/web/src/CaptureConfig.tsx` + `CaptureConfig.css`

Визуальный интерфейс для конфигурации всех параметров:

**Секции:**
1. **Basic Settings** — URL, max actions, timeout, crawl depth, admin mode toggle
2. **Domain Filters** — include/exclude доменов (comma-separated)
3. **Path Exclusions** — список путей для пропуска (one per line)
4. **Authentication Flow** — конструктор цепочки авторизации
   - Визуальное добавление/удаление шагов
   - Выбор типа действия (goto, fill, click, wait, screenshot)
   - Автоматическое сохранение session после захвата

---

## 📋 Полный пример использования

### Шаг 1: Захватить authenticated session

```bash
curl -X POST http://localhost:4000/api/auth-session \
  -H "Content-Type: application/json" \
  -d '{
    "actions": [
      { "type": "goto", "url": "https://kort.up.railway.app/login" },
      { "type": "fill", "selector": "input[type=email]", "value": "admin@kort.local" },
      { "type": "fill", "selector": "input[type=password]", "value": "demo1234" },
      { "type": "click", "selector": "button[type=submit]", "waitMs": 2000 },
      { "type": "wait", "selector": ".dashboard", "timeoutMs": 5000 }
    ],
    "timeoutMs": 60000
  }'
```

**Ответ:** `{ sourceUrl, cookies, storages }`

### Шаг 2: Использовать session в захвате

```bash
curl -X POST http://localhost:4000/api/capture \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://kort.up.railway.app/dashboard",
    "maxActionsPerPage": 20,
    "timeoutMs": 45000,
    "session": {
      "sourceUrl": "https://kort.up.railway.app/dashboard",
      "cookies": [...],
      "storages": [...]
    },
    "domainFilter": {
      "include": ["kort.up.railway.app"],
      "exclude": ["analytics.google.com", "cdn.jsdelivr.net"]
    },
    "pathExclusions": ["/logout", "/api/delete", "/admin/purge"],
    "crawlDepth": 3,
    "adminMode": true
  }'
```

---

## 🏗️ Архитектурные изменения

### API Changes
- ✅ Новый endpoint: `POST /api/auth-session`
- ✅ Расширены параметры `POST /api/capture`
- ✅ `CaptureJob` тип включает новые поля

### Backend Changes
- ✅ `loginCapture.ts` — логика захвата сессии
- ✅ `captureSite.ts` — функция `matchesDomainFilter()`
- ✅ `safeInteractions.ts` — поддержка `pathExclusions`, `adminMode`, `crawlDepth`
- ✅ `types.ts` — расширенные `CaptureOptions`

### Frontend Changes
- ✅ `CaptureConfig.tsx` + `.css` — визуальная конфигурация
- ✅ `App.tsx` — интеграция компонента, обновлена функция `runCapture()`

---

## 🧪 Как тестировать

### 1. С вашим сайтом https://kort.up.railway.app

```javascript
// В браузере, на странице UI:
1. Откройте вкладку "Launch" → "Новый захват"
2. Заполните "Authentication Flow":
   - Goto: https://kort.up.railway.app/login
   - Fill email input: admin@kort.local
   - Fill password input: demo1234
   - Click submit button (wait 2s)
   - Wait for .dashboard selector
3. Нажмите "Capture Login Session"
4. Когда session сохранится:
   - URL: https://kort.up.railway.app/dashboard
   - Admin Mode: ON
   - Crawl Depth: 3
   - Domain Filter Include: kort.up.railway.app
   - Domain Filter Exclude: google-analytics.com,cdn.jsdelivr.net
   - Path Exclusions: /logout, /api/delete
5. Нажмите "Start Capture"
```

### 2. Прямой API тест

```bash
# Запрос 1: Захватить session
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth-session \
  -H "Content-Type: application/json" \
  -d '{"actions":[...]}' | jq -r '.sourceUrl')

# Запрос 2: Основной capture с этой session
curl -X POST http://localhost:4000/api/capture \
  -H "Content-Type: application/json" \
  -d '{
    "url": "...",
    "session": {...},
    "adminMode": true,
    ...
  }'
```

---

## 🚀 Next Steps (если требуется расширение)

1. **BFS/DFS Crawling** — вместо случайных кликов, систематический обход
2. **Screenshot Timeline** — скриншоты на каждом уровне crawl depth
3. **Form Filling** — автоматическое заполнение форм на основе типов инпутов
4. **Diff Snapshots** — сравнение админ-панели между версиями (до/после обновления)
5. **Batch Operations** — одновременный захват нескольких админ-сайтов
6. **YAML Config** — сохранение и восстановление конфигов захватов

---

## 📊 Файлы изменений

```
apps/api/src/
├── capture/
│   ├── loginCapture.ts (NEW)
│   ├── captureSite.ts (UPDATED: matchesDomainFilter, domainFilter check)
│   ├── safeInteractions.ts (UPDATED: pathExclusions, adminMode, crawlDepth)
│   └── types.ts (UPDATED: CaptureOptions, DomainFilter)
└── app.ts (UPDATED: /api/auth-session endpoint, CaptureJob type, Zod schemas)

apps/web/src/
├── CaptureConfig.tsx (NEW)
├── CaptureConfig.css (NEW)
└── App.tsx (UPDATED: integrated CaptureConfig, runCapture with config)
```

---

## ✨ Features Summary

| Feature | Implemented | Tested |
|---------|-------------|--------|
| Login Session Capture | ✅ | Pending |
| Domain Filters | ✅ | Pending |
| Path Exclusions | ✅ | Pending |
| Crawl Depth | ✅ | Pending |
| Admin Mode | ✅ | Pending |
| UI Configuration | ✅ | Pending |

---

## 📝 Примечания

- **Session lifetime:** Cookies и storage сохраняются при захвате и передаются при запросе
- **Domain filter эффективность:** Заметно сокращает размер ZIP архива, исключая CDN, analytics и другие внешние ресурсы
- **Admin mode селекторы:** Добавлены селекторы для таблиц, табов, модальных окон — стандартные для админ-панелей
- **Crawl depth:** Отслеживает реальные переходы между страницами, не искусственное ограничение по времени

