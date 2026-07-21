# Mighty & Cringe: первый production-сервер в Hetzner

Этот runbook разворачивает техническое окружение в Hetzner Cloud, Helsinki.

> **Внимание:** не приглашайте реальных пользователей и не храните реальные персональные
> или голосовые данные, пока Google OAuth не настроен, а Object Storage и проверенная
> автоматизация резервного копирования не введены в эксплуатацию.

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

GOOGLE_CLIENT_ID=<GOOGLE_OAUTH_WEB_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<GOOGLE_OAUTH_WEB_CLIENT_SECRET>
ADMIN_EMAILS=<OWNER_GOOGLE_EMAIL>
TRAINER_EMAILS=
SESSION_TTL_DAYS=30

# Оставьте весь voice-блок пустым, пока не готовы одновременно S3 и OpenRouter.
OPENROUTER_API_KEY=
OPENROUTER_STT_MODEL=

VOICE_S3_ENDPOINT=
VOICE_S3_REGION=
VOICE_S3_BUCKET=
VOICE_S3_ACCESS_KEY_ID=
VOICE_S3_SECRET_ACCESS_KEY=
VOICE_S3_FORCE_PATH_STYLE=false
VOICE_S3_ENCRYPTION_KEY=

# Оставьте все три VAPID-поля пустыми до генерации стабильной пары.
VAPID_SUBJECT=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
WORKER_INTERVAL_MS=15000
```

В Google Cloud Console создайте OAuth client типа **Web application** и укажите точный
Authorized redirect URI:

```text
https://mightycringe.com/api/v1/auth/google/callback
```

Настройте OAuth consent screen и добавьте аккаунты-тестировщики, пока приложение находится в
режиме Testing. Значения client ID и secret внесите только в серверный файл. `ADMIN_EMAILS` —
список email через запятую; совпавшие подтверждённые Google-аккаунты получают роль `admin` при
входе. `TRAINER_EMAILS` таким же образом включает тренерский кабинет только для заранее
разрешённых аккаунтов. Права на `/etc/mighty-cringe/production.env` уже заданы предыдущей командой.
Preflight требует основные DB/OAuth-поля, но разрешает полностью пустые voice и VAPID-группы: эти
возможности останутся выключенными. Частично заполненная группа останавливает deploy до изменения
контейнеров; значения секретов в диагностике не печатаются.

### Приватный голос: Hetzner Object Storage

Не используйте bucket и credentials бэкапов для голоса. У Hetzner новый S3 key по умолчанию имеет
доступ ко всем bucket внутри проекта, поэтому самый понятный least-privilege вариант — отдельный
Hetzner project только для голосового bucket:

1. Создайте отдельный project, например `mighty-cringe-voice-production`.
2. В нём откройте **Object Storage → Create Bucket**, выберите Helsinki (`hel1`), задайте глобально
   уникальное имя и visibility **Private**. Не включайте versioning или Object Lock: явное удаление
   пользователя должно действительно удалять аудио. Включите защиту bucket от случайного удаления.
3. В этом же отдельном project создайте S3 credentials. Сразу сохраните access key и secret key в
   менеджере паролей: secret повторно не показывается.
4. На своём компьютере сгенерируйте отдельный SSE-C key:

   ```bash
   openssl rand -base64 32
   ```

   Сохраните результат в менеджере паролей и вставьте без кавычек в
   `VOICE_S3_ENCRYPTION_KEY`. Резервная копия вне VPS обязательна: Hetzner не хранит этот ключ, а
   без него уже загруженные записи невозможно прочитать. Не меняйте ключ, пока в bucket остаются
   записи, если они не были предварительно перешифрованы.

5. Заполните `VOICE_S3_*` в `/etc/mighty-cringe/production.env`. Для Helsinki endpoint —
   `https://hel1.your-objectstorage.com`, region — `hel1`.

Hetzner документирует отсутствие шифрования объектов по умолчанию и поддержку SSE-C:
https://docs.hetzner.com/storage/object-storage/faq/general/. Ограничения S3 keys и варианты
bucket policy описаны здесь:
https://docs.hetzner.com/storage/object-storage/faq/s3-credentials/.

### Приватный голос: OpenRouter

1. Создайте отдельный API key только для production Mighty & Cringe и установите небольшой credit
   limit. Не вставляйте ключ в GitHub, браузер или `VITE_*` переменные.
2. В OpenRouter **Privacy** отключите использование inputs/outputs и включите ZDR для группы,
   соответствующей выбранной STT-модели. В **Observability** оставьте **Input & Output Logging**
   выключенным. Код дополнительно отправляет `provider.zdr: true` на каждом запросе и завершает job
   ошибкой, если у модели нет совместимого ZDR endpoint.
3. Укажите `OPENROUTER_STT_MODEL=openai/whisper-large-v3` или другой актуальный slug из фильтра
   Transcription. Модель обязана принимать `webm`, `m4a/mp4` и `ogg`, которые создают мобильные
   браузеры.
4. Запишите key и model только в `/etc/mighty-cringe/production.env`.

Актуальный STT endpoint, форматы и поиск моделей:
https://openrouter.ai/docs/guides/overview/multimodal/stt. Политика ZDR:
https://openrouter.ai/docs/guides/features/zdr.

### Web Push: VAPID

Один раз на локальном компьютере сгенерируйте пару ключей:

```bash
pnpm --filter @mighty-cringe/push exec web-push generate-vapid-keys --json
```

Перенесите public/private значения в `VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY`, а в
`VAPID_SUBJECT` укажите контролируемый `mailto:` адрес продукта. Приватный ключ храните только в
`/etc/mighty-cringe/production.env`; не добавляйте его в GitHub или `VITE_*`. Не ротируйте пару без
необходимости: уже подписанные браузеры перестанут принимать сообщения и пользователям придётся
включать напоминания заново.

После deploy установите PWA на телефон, включите напоминания только через явную кнопку, поставьте
время на несколько минут вперёд и проверьте доставку вне тихих часов. Затем выключите напоминания и
убедитесь, что следующие задания не доставляются. На iPhone/iPad запрос Web Push доступен только для
приложения, добавленного на Home Screen.

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
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=100 worker
```

`migrate` должен завершиться с кодом `0`; остальные сервисы, включая `worker`, должны работать.
Проверка:

```bash
curl -fsS https://mightycringe.com/health
curl -fsS https://mightycringe.com/api/v1/auth/config
```

Ожидаемый ответ:

```json
{ "status": "ok" }
```

Второй запрос должен вернуть `{"googleEnabled":true}`. Затем в приватном окне браузера
проверьте вход, создание тренировки, выход и ответ `401` от `/api/v1/me` после выхода.

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

## 8. Object Storage и бэкапы перед реальными пользователями

Перед запуском реальных аккаунтов:

1. Создайте private bucket в Hetzner Helsinki, например `mighty-cringe-prod-rb-2026`.
2. Создайте S3 credentials и сохраните secret key: он не показывается повторно.
3. Используйте endpoint `https://hel1.your-objectstorage.com`.
4. Внесите credentials только в серверный `.env`.
5. Реализуйте и проверьте ежедневный encrypted PostgreSQL backup, WAL archive и
   ежемесячное восстановление в отдельном окружении.

Hetzner server backups — дополнительная защита, а не замена независимому бэкапу БД и медиа.

## Операционные команды

```bash
# Статус
cd ~/actions-runner/_work/mighty-cringe-main/mighty-cringe-main/infra/production
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose ps

# Логи API, worker и reverse proxy
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=200 api
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=200 worker
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=200 caddy

# Ручной повторный запуск уже полученной ревизии
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose up -d --build
```
