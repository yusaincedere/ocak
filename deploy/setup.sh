#!/usr/bin/env bash
# One-time setup on the VPS: writes .env and livekit.yaml with fresh secrets.
# Re-running keeps your existing .env (so sessions and keys stay valid).
set -euo pipefail
cd "$(dirname "$0")"

rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

if [[ ! -f .env ]]; then
  read -rp "Main domain for the app (e.g. chat.example.com): " DOMAIN
  read -rp "Domain for voice/video (e.g. rtc.example.com): " RTC_DOMAIN
  echo
  echo "Anyone with a room link can join a call. Starting NEW calls can require a server code,"
  echo "so strangers who find your site can't use your bandwidth. (Leave empty for no code.)"
  read -rp "Server code to start calls [recommended, e.g. wolfpack]: " CREATE_CODE

  cat > .env <<EOF
DOMAIN=${DOMAIN}
RTC_DOMAIN=${RTC_DOMAIN}
CREATE_CODE=${CREATE_CODE}
LIVEKIT_PUBLIC_URL=wss://${RTC_DOMAIN}
LIVEKIT_API_KEY=API$(rand 12)
LIVEKIT_API_SECRET=$(rand 48)
EOF
  chmod 600 .env
  echo "Wrote .env"
else
  echo ".env already exists - keeping it."
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

sed -e "s|__RTC_DOMAIN__|${RTC_DOMAIN}|" \
    -e "s|__LIVEKIT_API_KEY__|${LIVEKIT_API_KEY}|" \
    -e "s|__LIVEKIT_API_SECRET__|${LIVEKIT_API_SECRET}|" \
    livekit.yaml.template > livekit.yaml
chmod 600 livekit.yaml
echo "Wrote livekit.yaml"

cat <<EOF

Next:
  1. DNS: point A records for ${DOMAIN} and ${RTC_DOMAIN} at this server's IP.
  2. Firewall:
       ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
       ufw allow 7881/tcp && ufw allow 3478/udp && ufw allow 50000:50200/udp
       ufw enable
  3. Start:   docker compose up -d --build
  4. Open https://${DOMAIN}, pick a name, start a call and share the link.${CREATE_CODE:+
     Server code for starting calls: ${CREATE_CODE}}
EOF
