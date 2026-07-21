# Mighty & Cringe: первый production-сервер в Hetzner

Этот runbook разворачивает техническое окружение в Hetzner Cloud, Helsinki.

> **Внимание:** текущая версия не реализует Google OAuth и использует
> демонстрационного пользователя. Не приглашайте реальных пользователей и не храните
> реальные персональные или голосовые данные до внедрения авторизации, Object Storage
> и проверенной автоматизации резервного копирования.

## Целевая конфигурация

- Hetzner Cloud, Helsinki; CPX12 x86, Ubuntu 24.04 LTS.
- `mightycringe.com` и `www.mightycringe.com`.
- Docker Compose: Caddy, PWA, Fastify API и PostgreSQL. Worker подключается позднее
  отдельным профилем.
- SSH доступен только с IP администратора; HTTP/HTTPS доступны из интернета.
- Автодеплой делает self-hosted GitHub Actions runner на самом сервере. Он работает
  через исходящее соединение и не требует открывать SSH для GitHub-hosted runners.

Не отправляйте в чат `.env`, пароли, приватные SSH-ключи или S3 secret key.

## 1. Hetzner Cloud: проект, ключ и Firewall

1. Создайте проект `Mighty Cringe` в Hetzner Cloud Console.
2. На Mac создайте SSH-ключ, если его ещё нет:

   ```bash
   ssh-keygen -t ed25519 -C "rb@mightycringe"
   cat ~/.ssh/id_ed25519.pub
   ```

3. В Hetzner: **Security → SSH Keys → Add SSH Key**. Добавьте публичный ключ и
   выберите его при создании сервера.
4. Создайте Cloud Firewall:

   | Протокол | Порт | Источник                                      |
   | -------- | ---: | --------------------------------------------- |
   | TCP      |   22 | Внешний IPv4 администратора с суффиксом `/32` |
   | TCP      |   80 | `0.0.0.0/0` и `::/0`                          |
   | TCP      |  443 | `0.0.0.0/0` и `::/0`                          |

   Узнать свой IPv4: `curl https://api.ipify.org`.

5. Создайте сервер:

   - Location: **Helsinki**.
   - Type: **CPX12**, архитектура **x86**.
   - Image: **Ubuntu 24.04 LTS**.
   - Один public IPv4; созданный SSH key и Firewall.
   - Не включайте **Backups** до появления реальных пользовательских данных.
   - Name: `mightycringe-prod-01`.

6. Сохраните public IPv4 как `<SERVER_IP>`. После настройки включите protection from
   deletion в Console.

Object Storage пока не создавайте: приложение ещё не сохраняет аудио и не выгружает
бэкапы автоматически.

## 2. DNS в Prokbun

В панели DNS домена создайте записи:

| Тип | Имя   | Значение      | TTL |
| --- | ----- | ------------- | --: |
| A   | `@`   | `<SERVER_IP>` | 300 |
| A   | `www` | `<SERVER_IP>` | 300 |

Если используете IPv6, добавьте соответствующие AAAA-записи. Проверьте:

```bash
dig +short mightycringe.com
dig +short www.mightycringe.com
```

Обе команды должны вернуть адрес сервера до первого запуска Caddy.

## 3. Базовая защита Ubuntu

Подключитесь как root:

```bash
ssh root@<SERVER_IP>
```

Выполните:

```bash
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git fail2ban

adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

printf 'deploy ALL=(ALL:ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/deploy
chmod 440 /etc/sudoers.d/deploy
visudo -cf /etc/sudoers.d/deploy
```

Используйте Hetzner Cloud Firewall как единственный сетевой firewall для этого сервера.
Не настраивайте UFW: опубликованные Docker-порты могут обходить его правила. Включите Fail2ban:

```bash
systemctl enable --now fail2ban
```

В новом окне проверьте вход до отключения root:

```bash
ssh deploy@<SERVER_IP>
```

Затем создайте `/etc/ssh/sshd_config.d/99-mighty-cringe.conf` и перезагрузите сервер,
если после обновления системы это требуется:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

Примените настройки:

```bash
sshd -t
systemctl reload ssh
```

Если домашний IP изменится, обновите правило в Hetzner Firewall до следующего SSH-входа.

## 4. Swap и Docker

На CPX12 создайте 2 GB swap, чтобы первой сборке контейнеров не хватало памяти только в
исключительных случаях:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-mighty-cringe.conf
sudo sysctl --system
```

Войдите как `deploy` и выполните:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
. /etc/os-release
printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "${UBUNTU_CODENAME:-$VERSION_CODENAME}" "$(dpkg --print-architecture)" | sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy
```

Выйдите из SSH и войдите снова. Проверьте:

```bash
docker --version
docker compose version
```

## 5. GitHub Actions runner и production environment

Если GitHub organization запрещает Deploy Keys, не используйте PAT как обходной путь.
Self-hosted Actions runner сам получает private code через краткоживущий workflow token.

В `mighty-cringe/mighty-cringe-main`: **Settings → Actions → Runners → New self-hosted runner**.
Выберите Linux x64, скопируйте команды GitHub и выполните их на сервере под `deploy`.
При регистрации добавьте label `mighty-cringe-production`.

После регистрации включите runner как сервис:

```bash
cd ~/actions-runner
sudo ./svc.sh install deploy
sudo ./svc.sh start
sudo ./svc.sh status
```

Создайте защищённый каталог для production environment:

```bash
sudo install -d -m 750 -o deploy -g deploy /etc/mighty-cringe
sudo install -m 600 -o deploy -g deploy /dev/null /etc/mighty-cringe/production.env
openssl rand -hex 32
nano /etc/mighty-cringe/production.env
```

Подставьте сгенерированное значение вместо `<DB_PASSWORD>`:

```dotenv
DOMAIN=mightycringe.com

PORT=3000
WEB_ORIGIN=https://mightycringe.com
LOG_LEVEL=info

POSTGRES_DB=mightycringe
POSTGRES_USER=mightycringe
POSTGRES_PASSWORD=<DB_PASSWORD>
DATABASE_URL=postgresql://mightycringe:<DB_PASSWORD>@postgres:5432/mightycringe
```

Остальные поля оставьте пустыми до появления соответствующих интеграций. Права на
`/etc/mighty-cringe/production.env` уже заданы предыдущей командой. До подключения бэкапов
добавьте значения из раздела 8.

## 6. Первый запуск и проверка

Запустите **Actions → Deploy production → Run workflow** на ветке `main`. Runner выполнит
первый контролируемый запуск. После него обычные production-релизы запускаются автоматически
только для текущего коммита `main`, успешно прошедшего CI.
Затем на сервере можно проверить:

```bash
cd ~/actions-runner/_work/mighty-cringe-main/mighty-cringe-main/infra/production
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose ps
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=100 migrate
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=100 caddy
```

`migrate` должен завершиться с кодом `0`; остальные сервисы должны работать. Worker не
запускается на CPX12 по умолчанию. Проверка:

```bash
curl -fsS https://mightycringe.com/health
```

Ожидаемый ответ:

```json
{ "status": "ok" }
```

## 7. Автоматический deploy через server-side runner

В GitHub создайте environment `production` через **Settings → Environments**, ограничьте
деплой веткой `main`. Если добавить обязательный manual approval, workflow будет ждать
подтверждения и перестанет быть полностью автоматическим.

При каждом push/merge в `main` workflow `CI` проверяет форматирование, типы, сборку и тесты на
GitHub-hosted runner. Только после успеха он вызывает `Deploy production` и передаёт точный SHA.
Server-side runner убеждается, что SHA всё ещё является вершиной `main`, сериализует релизы,
проверяет production-конфигурацию, выполняет `docker compose up -d --build`, ждёт успешных
миграций и проверяет публичный HTTPS health endpoint. При ошибке Actions остаётся красным и
показывает статус сервисов и ограниченный фрагмент логов. GitHub SSH secrets, Deploy Keys и
personal access tokens для этого подхода не нужны.

## 8. Object Storage и зашифрованные бэкапы

Перед запуском реальных аккаунтов:

1. Создайте private bucket в Hetzner Helsinki, например `mighty-cringe-prod-rb-2026`.
2. Создайте отдельные S3 credentials для бэкапов и сразу сохраните secret key: Hetzner не
   показывает его повторно. Ограничьте key политикой только этим bucket, если credentials
   находятся в отдельном проекте.
3. Сгенерируйте независимый пароль шифрования: `openssl rand -hex 32`. Сохраните его в
   password manager и ещё в одной офлайн-копии: без него восстановление невозможно.
4. Добавьте в `/etc/mighty-cringe/production.env`:

   ```dotenv
   S3_ENDPOINT=https://hel1.your-objectstorage.com
   S3_REGION=hel1
   S3_BUCKET=<PRIVATE_BUCKET_NAME>
   S3_ACCESS_KEY=<BACKUP_ACCESS_KEY>
   S3_SECRET_KEY=<BACKUP_SECRET_KEY>
   RESTIC_PASSWORD=<INDEPENDENT_ENCRYPTION_PASSWORD>
   BACKUP_KEEP_DAILY=14
   BACKUP_KEEP_WEEKLY=8
   BACKUP_KEEP_MONTHLY=12
   RESTIC_CHECK_SUBSET=5%
   ```

5. После деплоя проверьте таймеры и вручную выполните обе операции:

   ```bash
   systemctl list-timers 'mighty-cringe-*'
   sudo systemctl start mighty-cringe-backup.service
   sudo journalctl -u mighty-cringe-backup.service -n 200 --no-pager
   sudo systemctl start mighty-cringe-restore-check.service
   sudo journalctl -u mighty-cringe-restore-check.service -n 200 --no-pager
   ```

Ежедневная операция создаёт custom-format dump в tmpfs, проверяет его, шифрует на стороне клиента
через restic, применяет retention и читает случайные 5% данных репозитория. Ежемесячная проверка
загружает последний snapshot и применяет его к отдельному PostgreSQL в tmpfs. Успех засчитывается
только после чтения таблиц `users`, `workouts` и `sets`. RPO — 24 часа, целевой RTO — 4 часа.

### Полное восстановление после потери PostgreSQL

1. Остановите запись в API: `docker compose stop api worker`.
2. Убедитесь, что известен момент сбоя, и сохраните повреждённый volume или snapshot для разбора.
3. Запустите `mighty-cringe-restore-check.service`. Не продолжайте, если изолированная проверка
   последнего snapshot неуспешна.
4. Создайте новый пустой PostgreSQL volume или новый сервер. Не восстанавливайте поверх единственной
   копии повреждённой базы.
5. Восстановите snapshot только в новую БД с уникальным именем. Скрипт откажется писать поверх
   активной базы и завершится ошибкой, если `pg_restore` или чтение основных таблиц неуспешно:

   ```bash
   cd ~/actions-runner/_work/mighty-cringe-main/mighty-cringe-main/infra/production
   PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env \
     scripts/restore-to-new-database.sh mightycringe_recovery_20260721
   ```

6. Остановите API, замените `POSTGRES_DB` и соответствующий `DATABASE_URL` в
   `/etc/mighty-cringe/production.env` на имя восстановленной базы, затем примените миграции и
   запустите сервисы:

   ```bash
   PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose stop api worker
   sudo nano /etc/mighty-cringe/production.env
   PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose up -d migrate api
   ```

7. Проверьте `/health`, вход, количество пользователей и историю тренировок. Зафиксируйте время
   snapshot — все изменения после него входят в заявленный RPO.
8. Только после проверки переключите трафик и сохраните старую базу до завершения разбора инцидента.

При полной потере VPS сначала разверните новый пустой PostgreSQL на новом сервере и скопируйте туда
только `production.env` из защищённого источника. Затем выполните шаги 3–8: restic скачает snapshot
из Object Storage независимо от потерянного Docker volume.

Hetzner server backups — дополнительная защита, а не замена независимому бэкапу БД и медиа.

## 9. Мониторинг и уведомления

До merge мониторинга создайте в Healthchecks.io отдельный check `mighty-cringe-production`:

1. Установите period **5 minutes** и grace time **10 minutes**.
2. В Integrations подключите личный email или другой канал и отправьте тестовое уведомление.
3. Скопируйте UUID Ping URL. Считайте его секретом: любой, кто знает URL, может подменять сигналы.
4. Добавьте в `/etc/mighty-cringe/production.env` без кавычек:

   ```dotenv
   HEALTHCHECKS_PING_URL=https://hc-ping.com/<CHECK_UUID>
   MONITOR_DISK_CRITICAL_PERCENT=90
   MONITOR_BACKUP_MAX_AGE_SECONDS=129600
   MONITOR_RESTORE_MAX_AGE_SECONDS=3456000
   ```

После деплоя workflow сам запускает первую проверку. Убедитесь, что check перешёл в состояние Up:

```bash
systemctl status mighty-cringe-monitor.timer --no-pager
sudo systemctl start mighty-cringe-monitor.service
sudo journalctl -u mighty-cringe-monitor.service -n 100 --no-pager
```

Проверка каждые пять минут обращается к публичному `/health`, убеждается, что `caddy`, `web`, `api`
и `postgres` запущены, выполняет `pg_isready`, контролирует таймеры и свежесть успешных backup и
restore, а также заполнение `/` и `/var/lib/docker`. Явная ошибка отправляется через `/fail` с
короткой диагностикой. Если VPS выключен или потерял сеть, отсутствие очередного heartbeat приводит
к уведомлению после grace time.

Для контролируемого end-to-end теста временно остановите API не более чем на одну проверку, затем
сразу запустите его снова. Не оставляйте production неработающим:

```bash
cd ~/actions-runner/_work/mighty-cringe-main/mighty-cringe-main/infra/production
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose stop api
sudo systemctl start mighty-cringe-monitor.service || true
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose start api
curl -fsS https://mightycringe.com/health
```

Должно прийти аварийное уведомление, а следующий успешный запуск мониторинга должен отправить
recovery. Если уведомления нет, проверяйте интеграцию Healthchecks.io до допуска реальных данных.

Логи контейнеров ротируются Docker `local` driver: максимум три файла по 10 MB на контейнер. Caddy
пишет структурированный access log, Fastify — application log. Команды диагностики:

```bash
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env \
  docker compose logs --since=30m --tail=300 api caddy postgres
sudo journalctl -u mighty-cringe-monitor.service -u mighty-cringe-backup.service \
  --since='1 hour ago' --no-pager
journalctl --disk-usage
df -h / /var/lib/docker
```

Journald хранит persistent-логи до 30 дней, использует не более 256 MB и оставляет минимум 1 GB
свободного места. Не вставляйте Ping URL, environment или полные пользовательские данные в issue и
чаты при разборе инцидента.

## Операционные команды

```bash
# Статус
cd ~/actions-runner/_work/mighty-cringe-main/mighty-cringe-main/infra/production
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose ps

# Логи API и reverse proxy
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=200 api
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=200 caddy

# Ручной повторный запуск уже полученной ревизии
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose up -d --build

# Состояние и журнал последнего бэкапа
systemctl status mighty-cringe-backup.timer mighty-cringe-restore-check.timer
sudo journalctl -u mighty-cringe-backup.service -n 100 --no-pager
```
