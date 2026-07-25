# Локальный запуск Mighty & Cringe

Один и тот же путь запускает PWA, API, worker и PostgreSQL без production-секретов. PostgreSQL
работает в отдельном Docker Compose project либо в изолированном native-каталоге, а
TypeScript-сервисы — на хосте с hot reload. Данные сохраняются между перезапусками.

## Первый запуск на чистом checkout

Понадобятся Node.js 22+ и pnpm из корневого `packageManager`. Для PostgreSQL подходит один из двух
вариантов: Docker Desktop / Docker Engine + Compose либо установленный native PostgreSQL 16+.
Скрипт сам выбирает доступный вариант; принудительно выбрать можно через
`LOCAL_POSTGRES_BACKEND=docker` или `LOCAL_POSTGRES_BACKEND=native`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm local:doctor
pnpm local:dev
```

После строки о готовности откройте `http://localhost:5173`. API доступен на
`http://localhost:3000`, PostgreSQL — только локально на `127.0.0.1:55432`.

`local:dev` сам выполняет следующие действия:

1. запускает PostgreSQL в отдельном Compose volume либо в `.local/postgres` и ждёт готовности;
2. применяет все Drizzle migrations;
3. собирает внутренние workspace-пакеты, необходимые приложениям на чистом checkout;
4. включает явный `LOCAL_DEMO_AUTH=true` только с `NODE_ENV=development`;
5. запускает PWA, API и worker с общей `DATABASE_URL`.

Google OAuth, S3, OpenRouter и VAPID для базовой локальной проверки не нужны. Пустые provider
credentials оставляют соответствующие интеграции выключенными. Если нужен настоящий поиск новых
упражнений, добавьте `OPENROUTER_API_KEY` и `EXERCISE_DISCOVERY_MODEL` в `apps/api/.env`; эти значения
не попадут в браузер.

## Локальная приёмка записи голоса без секретов

Изолированный acceptance-сервер принимает аудио только в оперативную память и не обращается к S3,
OpenRouter или worker. Он нужен, чтобы проверить на `localhost` разрешение микрофона, сохранение Blob
в IndexedDB, отправку и локальное воспроизведение. Расшифровка намеренно остаётся в состоянии
«В очереди распознавания».

Сначала соберите API, затем запустите два процесса в отдельных терминалах:

```bash
pnpm build:packages
pnpm --filter @mighty-cringe/api build
pnpm local:voice-acceptance:api
```

```bash
pnpm --filter @mighty-cringe/web dev
```

Откройте `http://localhost:5173`, начните тренировку и сделайте короткую запись через «Пояснить».
После остановки должна появиться строка «В очереди распознавания» без сообщения о нехватке места.
В настройках запись должна воспроизводиться. После `Ctrl+C` тестовое серверное аудио исчезает.

## Остановка и повторный запуск

Остановите dev-процессы через `Ctrl+C`, затем при необходимости остановите PostgreSQL:

```bash
pnpm local:stop
```

Команда сохраняет Docker volume. Следующий `pnpm local:dev` увидит созданные тренировки и повторно
применит только недостающие миграции. Текущее состояние контейнера:

```bash
pnpm local:status
```

## Полный сброс локальных данных

Следующая команда удаляет только именованный volume проекта `mighty-cringe-local` либо каталог
`.local/postgres`, создаёт чистую базу и применяет миграции заново:

```bash
pnpm local:reset -- --yes
```

Без `--yes` удаление не выполняется. Команда не затрагивает production и другие Docker Compose
проекты.

## Короткая приёмка перед merge

1. Запустите `pnpm local:dev` и откройте PWA.
2. Начните тренировку, измените план и запишите подход.
3. Нажмите `Ctrl+C`, снова выполните `pnpm local:dev` и обновите страницу.
4. Убедитесь, что тренировка и подход сохранились.
5. Выполните `pnpm test`.

После этой проверки владелец явно разрешает merge согласно `AGENTS.md`.
