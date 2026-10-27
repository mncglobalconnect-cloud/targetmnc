#!/usr/bin/env bash
# One-time HTTPS setup for target.mncgroups.com on the VPS (run as root):
#   1. starts the app container on 127.0.0.1:3000 (image target-mnc:latest, env /opt/target-mnc/.env)
#   2. installs nginx and serves the domain over HTTPS (HTTP redirects to HTTPS)
#   3. obtains a Let's Encrypt certificate for the domain and installs a renewal timer
#   4. keeps the existing MongoDB IP-certificate renewal working: nginx now owns port 80, so that
#      renewal's standalone certbot listens on 127.0.0.1:8888 and nginx forwards its challenge requests.
# Safe to re-run.
set -Eeuo pipefail

DOMAIN=target.mncgroups.com
APP_PORT=3000
WEBROOT=/var/www/letsencrypt
CERTBOT_IMAGE=certbot/certbot:v5.4.0
MONGO_RENEW=/usr/local/sbin/renew-mongodb-ip-certificate
ENV_FILE=/opt/target-mnc/.env

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }

echo "== Securing $ENV_FILE"
chown root:root /opt/target-mnc "$ENV_FILE"
chmod 700 /opt/target-mnc
chmod 600 "$ENV_FILE"

echo "== App container on 127.0.0.1:$APP_PORT"
if ! docker ps --format '{{.Names}}' | grep -qx target-mnc; then
  docker rm -f target-mnc >/dev/null 2>&1 || true
  docker run -d --name target-mnc --restart unless-stopped \
    -p 127.0.0.1:$APP_PORT:3000 --env-file "$ENV_FILE" \
    --log-opt max-size=10m --log-opt max-file=3 target-mnc:latest >/dev/null
fi
for i in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$APP_PORT/login" && break; sleep 2; done
curl -fs -o /dev/null "http://127.0.0.1:$APP_PORT/login" || { echo "App did not start; see: docker logs target-mnc" >&2; exit 1; }

echo "== nginx"
if ! command -v nginx >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx >/dev/null
fi
mkdir -p "$WEBROOT"
rm -f /etc/nginx/sites-enabled/default

# Port 80: ACME challenges for the domain (webroot), challenges for the MongoDB IP certificate
# (forwarded to the standalone certbot on :8888 during its renewal), everything else -> HTTPS.
cat > /etc/nginx/conf.d/00-acme-and-redirect.conf <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location ^~ /.well-known/acme-challenge/ {
        proxy_pass http://127.0.0.1:8888;
        proxy_set_header Host \$host;
    }
    location / { return 444; }
}
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 301 https://\$host\$request_uri; }
}
EOF
rm -f /etc/nginx/conf.d/target-mnc.conf
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx

echo "== MongoDB IP-certificate renewal: move standalone certbot behind nginx"
if [ -f "$MONGO_RENEW" ] && grep -q -- '--publish 80:80' "$MONGO_RENEW"; then
  cp -p "$MONGO_RENEW" "$MONGO_RENEW.before-nginx"
  sed -i 's/--publish 80:80/--publish 127.0.0.1:8888:80/' "$MONGO_RENEW"
fi

echo "== Certificate for $DOMAIN"
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  docker run --rm \
    --mount type=bind,source=/etc/letsencrypt,target=/etc/letsencrypt \
    --mount type=bind,source=/var/lib/letsencrypt,target=/var/lib/letsencrypt \
    --mount type=bind,source=$WEBROOT,target=$WEBROOT \
    $CERTBOT_IMAGE certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email
fi

echo "== HTTPS site"
cat > /etc/nginx/conf.d/target-mnc.conf <<EOF
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 5m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
EOF
nginx -t
systemctl reload nginx

echo "== Renewal timer for $DOMAIN"
cat > /usr/local/sbin/renew-target-certificate <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
before=\$(readlink -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem)
docker run --rm \\
  --mount type=bind,source=/etc/letsencrypt,target=/etc/letsencrypt \\
  --mount type=bind,source=/var/lib/letsencrypt,target=/var/lib/letsencrypt \\
  --mount type=bind,source=$WEBROOT,target=$WEBROOT \\
  $CERTBOT_IMAGE renew --non-interactive --cert-name $DOMAIN
after=\$(readlink -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem)
if [ "\$before" != "\$after" ]; then nginx -t && systemctl reload nginx && echo "Reloaded nginx with renewed certificate."; fi
EOF
chmod 755 /usr/local/sbin/renew-target-certificate
cat > /etc/systemd/system/target-certificate.service <<EOF
[Unit]
Description=Renew Let's Encrypt certificate for $DOMAIN
Requires=docker.service
After=docker.service network-online.target nginx.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/renew-target-certificate
EOF
cat > /etc/systemd/system/target-certificate.timer <<EOF
[Unit]
Description=Check $DOMAIN certificate renewal twice daily
[Timer]
OnCalendar=*-*-* 03,15:00:00
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now target-certificate.timer >/dev/null

echo "== Renewal dry runs"
docker run --rm \
  --mount type=bind,source=/etc/letsencrypt,target=/etc/letsencrypt \
  --mount type=bind,source=/var/lib/letsencrypt,target=/var/lib/letsencrypt \
  --mount type=bind,source=$WEBROOT,target=$WEBROOT \
  $CERTBOT_IMAGE renew --dry-run --non-interactive --cert-name "$DOMAIN" 2>&1 | grep -E "Congratulations|success|fail" || true
if [ -d /etc/letsencrypt/live/mongodb-ip ]; then
  docker run --rm --publish 127.0.0.1:8888:80 \
    --mount type=bind,source=/etc/letsencrypt,target=/etc/letsencrypt \
    --mount type=bind,source=/var/lib/letsencrypt,target=/var/lib/letsencrypt \
    $CERTBOT_IMAGE renew --dry-run --non-interactive --cert-name mongodb-ip 2>&1 | grep -E "Congratulations|success|fail" || true
fi

echo "== Check"
curl -fsS -o /dev/null -w "https://$DOMAIN/login -> %{http_code}\n" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/login"
curl -sS -o /dev/null -w "http://$DOMAIN/ -> %{http_code} (redirect)\n" --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/"
echo "DONE: https://$DOMAIN"
