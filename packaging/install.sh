#!/usr/bin/env bash
# FallingLight Media Controller installer for Ubuntu/Debian and Arch Linux.
# Usage: sudo ./packaging/install.sh            install or upgrade
#        sudo ./packaging/install.sh --no-deps  skip package installation
set -euo pipefail

APP=fallinglight-media-controller
PREFIX=/opt/$APP
STATE=/var/lib/$APP
ENV_FILE=/etc/$APP.env
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DEPS=1
[[ "${1:-}" == "--no-deps" ]] && INSTALL_DEPS=0

log() { printf '\033[1;35m[flmc]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[flmc] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo)."
[[ -r /etc/os-release ]] || die "Cannot detect distribution (/etc/os-release missing)."
. /etc/os-release
FAMILY=""
case " ${ID:-} ${ID_LIKE:-} " in
  *" arch "*) FAMILY=arch ;;
  *" ubuntu "*|*" debian "*) FAMILY=debian ;;
  *) die "Unsupported distribution: ${ID:-unknown}. Supported: Ubuntu/Debian, Arch Linux." ;;
esac
log "Detected $FAMILY family (${PRETTY_NAME:-$ID})"

ARCH="$(uname -m)"
install_bun_binary() {
  # Bun is not packaged in Ubuntu's repositories; use the official release zip.
  local asset
  case "$ARCH" in
    x86_64) asset=bun-linux-x64 ;;
    aarch64) asset=bun-linux-aarch64 ;;
    *) die "No Bun build for $ARCH" ;;
  esac
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/oven-sh/bun/releases/latest/download/$asset.zip" -o "$tmp/bun.zip"
  unzip -q "$tmp/bun.zip" -d "$tmp"
  install -m755 "$tmp/$asset/bun" /usr/local/bin/bun
  rm -rf "$tmp"
}

install_ytdlp_binary() {
  # Ubuntu's yt-dlp package is often too old for current YouTube changes.
  curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod 755 /usr/local/bin/yt-dlp
}

if [[ $INSTALL_DEPS -eq 1 ]]; then
  if [[ $FAMILY == arch ]]; then
    log "Installing packages with pacman"
    pacman -S --needed --noconfirm bun yt-dlp ffmpeg deno
  else
    log "Installing packages with apt"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y ffmpeg curl unzip ca-certificates python3
    command -v bun >/dev/null || install_bun_binary
    install_ytdlp_binary
  fi
fi

for c in bun yt-dlp ffmpeg; do command -v "$c" >/dev/null || die "Missing dependency: $c"; done

# Build the web UI when the checkout has no prebuilt dist/.
if [[ ! -f "$SRC_DIR/dist/index.html" ]]; then
  log "Building the web UI"
  (cd "$SRC_DIR/frontend" && bun install --frozen-lockfile && bun run build)
fi

log "Creating service user and directories"
id -u fallinglight >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin fallinglight
install -d -o fallinglight -g fallinglight "$STATE" "$STATE/uploads" "$STATE/data"

log "Copying application to $PREFIX"
install -d "$PREFIX"
rm -rf "$PREFIX/src" "$PREFIX/public" "$PREFIX/dist"
cp -r "$SRC_DIR/src" "$SRC_DIR/public" "$SRC_DIR/dist" "$PREFIX/"
install -m644 "$SRC_DIR/package.json" "$SRC_DIR/bun.lock" "$SRC_DIR/tsconfig.json" "$PREFIX/"
(cd "$PREFIX" && bun install --production --frozen-lockfile)

[[ -f $ENV_FILE ]] || install -m600 "$SRC_DIR/packaging/$APP.env" "$ENV_FILE"
install -m644 "$SRC_DIR/packaging/$APP.service" "/etc/systemd/system/$APP.service"

if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
  systemctl daemon-reload
  systemctl enable --now "$APP.service"
  systemctl restart "$APP.service"
  log "Service started: systemctl status $APP"
else
  log "systemd is not running; start manually: cd $PREFIX && bun run src/index.ts"
fi

log "Done. Open http://<this-machine-ip>:6140 . Change APP_PASS in $ENV_FILE ."
