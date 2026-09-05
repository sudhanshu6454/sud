#!/bin/bash
# Runs once on first MariaDB start: one database + user per site (SITE_KEYS=MENTALIST,CRAZY,...).
set -euo pipefail
IFS=',' read -ra KEYS <<< "${SITE_KEYS:-}"
for key in "${KEYS[@]}"; do
  db="wp_$(echo "$key" | tr '[:upper:]' '[:lower:]')"
  var="WP_${key}_DB_PASSWORD"
  pass="${!var:-}"
  if [ -z "$pass" ]; then echo "!! $var not set, skipping $db" >&2; continue; fi
  echo ">> creating database $db"
  mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$db'@'%' IDENTIFIED BY '$pass';
ALTER USER '$db'@'%' IDENTIFIED BY '$pass';
GRANT ALL PRIVILEGES ON \`$db\`.* TO '$db'@'%';
FLUSH PRIVILEGES;
SQL
done
