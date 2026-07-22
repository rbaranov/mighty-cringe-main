# Mighty & Cringe — сделано

**Обновлён:** 2026-07-22

## 2026-07-22 — релиз продуктового бэклога

- В `main` последовательно влиты PR #6, #8 и #12—#18; все соответствующие feature-ветки удалены
  локально и в GitHub.
- В production развёрнуты offline-восстановление критичных экранов, natural-text ввод, приватный
  голосовой pipeline, неизменяемые источники manual/text/voice, read-only кабинет тренера, opt-in
  push и локализация RU/EN с metric/imperial.
- Добавлены зашифрованные PostgreSQL backup→restore и production monitoring. Пока credentials не
  настроены, backup и monitoring timers безопасно выключены; CI проверяет их Docker recovery и
  success/failure сигналы перед каждым релизом.
- Production preflight получил собственный Node.js 22 и all-or-nothing проверку необязательных
  backup, monitoring, voice и push-групп без вывода секретов.
- GitHub Actions run
  [#29891045849](https://github.com/mighty-cringe/mighty-cringe-main/actions/runs/29891045849)
  успешно выполнил полный CI, миграции, production deploy и публичный HTTPS healthcheck для
  ревизии `5623b78306d3661da6686d8a5b93893c69a7c8e9`.
- После релиза `https://mightycringe.com/health` отвечает `{"status":"ok"}`, Google OAuth включён,
  callback совпадает с production URL, а анонимный API отвечает `401`.
- Реализации зафиксированы здесь как выпущенные; в разделе «Ждёт владельца» файла `BACKLOG.md`
  остаются только credential- и acceptance-действия на реальных аккаунтах и телефоне.

Карта релиза: [OAuth #5](https://github.com/mighty-cringe/mighty-cringe-main/pull/5),
[backup #6](https://github.com/mighty-cringe/mighty-cringe-main/pull/6),
[sync #7](https://github.com/mighty-cringe/mighty-cringe-main/pull/7),
[monitoring #8](https://github.com/mighty-cringe/mighty-cringe-main/pull/8),
[workout editing #9](https://github.com/mighty-cringe/mighty-cringe-main/pull/9),
[progress #10](https://github.com/mighty-cringe/mighty-cringe-main/pull/10),
[measurements #11](https://github.com/mighty-cringe/mighty-cringe-main/pull/11),
[offline recovery #12](https://github.com/mighty-cringe/mighty-cringe-main/pull/12),
[natural text #13](https://github.com/mighty-cringe/mighty-cringe-main/pull/13),
[voice #14](https://github.com/mighty-cringe/mighty-cringe-main/pull/14),
[AI provenance #15](https://github.com/mighty-cringe/mighty-cringe-main/pull/15),
[trainer access #16](https://github.com/mighty-cringe/mighty-cringe-main/pull/16),
[push #17](https://github.com/mighty-cringe/mighty-cringe-main/pull/17) и
[localization #18](https://github.com/mighty-cringe/mighty-cringe-main/pull/18).

## 2026-07-20—21 — фундамент продукта и первый production-запуск

### Продуктовая основа

- Зафиксированы продуктовая логика и интерактивные mockups версии `0.2.8` в
  `docs/product/`.
- Определена первая граница MVP: личный журнал силовых тренировок.
- Принят принцип offline-first: локальная запись на телефоне, очередь синхронизации и
  идемпотентные серверные мутации.

### Первый вертикальный срез приложения

- Реализована адаптивная React PWA с русским интерфейсом и установкой через service worker.
- Реализованы старт и локальное завершение тренировки, ручное добавление подхода с весом,
  повторами, RIR и комментарием, а также базовый экран прогресса.
- Добавлен начальный каталог упражнений с русскими/английскими названиями, синонимами,
  оборудованием и тегами Mighty / Normal / Cringe.
- Локальные тренировки, подходы, каталог и outbox хранятся в IndexedDB.
- Реализована доставка созданных тренировок и подходов при наличии сети без дубликатов при
  повторной отправке.

### API и база данных

- Создан Fastify API с каталогом упражнений, журналом тренировок, созданием тренировок и
  подходов, batch-sync и health endpoint.
- Созданы PostgreSQL-схема и миграции Drizzle для пользователей, упражнений, тренировок,
  подходов и идемпотентных client mutations.
- Добавлен API-тест безопасного повтора мутаций и возврата истории тренировок.
- Реализован development-режим с демонстрационным пользователем.

### Production-платформа и доставка

- Выбран отдельный Hetzner Cloud вместо сервера `emirtest.kz`; решение зафиксировано в
  [ADR 0001](adr/0001-production-platform.md).
- Создан сервер `mightycringe-prod-01` в Helsinki: Ubuntu 24.04, CPX12 x86 и 2 GB swap.
- Развёрнут Docker Compose: Caddy, PWA, API и PostgreSQL в приватной Docker-сети;
  PostgreSQL не опубликован в интернет.
- Настроены `mightycringe.com` и `www.mightycringe.com`; Caddy обслуживает TLS.
- Настроены Cloud Firewall, отдельный пользователь `deploy`, SSH без root/password login,
  Fail2ban, Docker и Docker Compose.
- Создан private GitHub repository в организации `mighty-cringe`.
- Настроен self-hosted GitHub Actions runner на production-сервере как systemd service.
- Добавлен ручной production workflow: сборка/запуск Compose, миграции и HTTPS health check.
- Выполнен успешный production-деплой и проверка `https://mightycringe.com/health`.

## 2026-07-21 — управление документацией

- Добавлен корневой `AGENTS.md` с описанием проекта, границами безопасности и правилами работы.
- Добавлены пользовательский `docs/BACKLOG.md` и журнал `docs/DONE.md`.
- Зафиксировано правило: доработки ведутся в отдельных ветках, merge в `main` выполняется
  только после явного разрешения владельца.

## 2026-07-21 — автоматическая доставка в production

- Исправлен CI на чистом checkout: версия pnpm берётся из `packageManager`, внутренние пакеты
  собираются до typecheck, затем выполняются тесты API.
- После успешного CI для текущего SHA `main` автоматически запускается production workflow;
  PR и неуспешные проверки не могут запустить деплой.
- Production runner проверяет точный SHA и конфигурацию, сериализует релизы, отклоняет
  устаревшую ревизию, применяет миграции и запускает Docker Compose.
- Неуспешный Compose или HTTPS health check оставляет Actions красным и публикует ограниченные
  диагностические логи вместо ложного успешного релиза.
- Первый автоматический pipeline для `8f7f125` успешно прошёл CI, миграции, deploy и внутренний
  health check; внешний `https://mightycringe.com/health` подтверждён ответом `{"status":"ok"}`.
