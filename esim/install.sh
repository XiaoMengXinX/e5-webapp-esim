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
  (
   flock -n 9 || exit 0
   exec sh "$DIR/install.sh" run >"$RUN/install.log" 2>&1
  ) 9>"$RUN/lock" </dev/null >/dev/null 2>&1 &
  ;;
 run)
  trap 'echo "$?" > "$RUN/result"' EXIT
  cp "$DIR/package.sha256" "$RUN/attempt.sha256"
  cd "$DIR"
  sha256sum -c package.sha256
  apk update
  apk add --allow-untrusted ./luci-app-e5-esim.apk
  cp package.sha256 .installed-sha256
  ;;
 *) exit 2 ;;
esac
