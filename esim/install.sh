#!/bin/sh
set -eu
DIR=/etc/e5-infoscreen/plugins/esim
RUN=/tmp/e5-webapp-esim

check() {
 apk info -e luci-app-e5-esim >/dev/null 2>&1 &&
 [ "$(cat "$DIR/.installed-sha256" 2>/dev/null)" = "$(cat "$DIR/package.sha256")" ] &&
 [ -x /usr/libexec/rpcd/e5-esim ]
}

case "${1:-}" in
 check) check ;;
 start)
  mkdir -p "$RUN"
  chmod 700 "$RUN"
  exec 9>"$RUN/lock"
  flock -n 9 || exit 0
  cp "$DIR/package.sha256" "$RUN/package.sha256"
  cp "$DIR/luci-app-e5-esim.apk" "$RUN/luci-app-e5-esim.apk"
  cp "$RUN/package.sha256" "$DIR/.install-attempt"
  echo running > "$RUN/result"
  sh "$DIR/install.sh" run </dev/null >"$RUN/install.log" 2>&1 &
  ;;
 run)
  trap 'echo "$?" > "$RUN/result"' EXIT
  cd "$RUN"
  sha256sum -c package.sha256
  apk update
  apk add --allow-untrusted "$RUN/luci-app-e5-esim.apk"
  cp package.sha256 "$DIR/.installed-sha256"
  ;;
 *) exit 2 ;;
esac
