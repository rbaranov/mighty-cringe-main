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
`/etc/mighty-cringe/production.env` уже заданы предыдущей командой.

## 6. Первый запуск и проверка

Запустите **Actions → Deploy production → Run workflow**. Runner выполнит первый запуск.
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
деплой веткой `main` и при необходимости добавьте manual approval. Затем:
**Actions → Deploy production → Run workflow → main**.

Workflow запускается на server-side runner, получает актуальный `main` через
`actions/checkout` и выполняет `docker compose up -d --build`. GitHub SSH secrets,
Deploy Keys и personal access tokens для этого подхода не нужны.

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

# Логи API и reverse proxy
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=200 api
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose logs --tail=200 caddy

# Ручной повторный запуск уже полученной ревизии
PRODUCTION_ENV_FILE=/etc/mighty-cringe/production.env docker compose up -d --build
```
