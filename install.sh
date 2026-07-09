#!/usr/bin/env bash
# Установщик MCP-сервера Speed Insights (PageSpeed Insights для ИИ-агента).
# Регистрирует сервер в Claude Code (user scope) и сохраняет API-ключ Google.
#
# Использование:
#   ./install.sh                 # интерактивно спросит ключ
#   PSI_API_KEY=xxx ./install.sh # взять ключ из окружения, без вопросов
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$HERE/server.mjs"
KEY_FILE="$HERE/.psi_key"
MCP_NAME="${MCP_NAME:-psi}"

echo "== Установка MCP-сервера Speed Insights =="
echo "   каталог: $HERE"

# 1. Проверки окружения
if ! command -v node >/dev/null 2>&1; then
  echo "ОШИБКА: не найден node. Установите Node.js 18+ и повторите." >&2
  exit 1
fi
echo "   node:    $(node --version)"

if [ ! -f "$SERVER" ]; then
  echo "ОШИБКА: не найден $SERVER" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "ПРЕДУПРЕЖДЕНИЕ: не найден CLI 'claude'. Ключ сохраню, но сервер не зарегистрирую." >&2
  CLAUDE_OK=0
else
  CLAUDE_OK=1
fi

# 2. Получение API-ключа
API_KEY="${PSI_API_KEY:-}"
if [ -z "$API_KEY" ] && [ -f "$KEY_FILE" ]; then
  read -r -p "Ключ уже сохранён. Перезаписать? [y/N] " ans
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    API_KEY="$(cat "$KEY_FILE")"
    echo "   оставляю существующий ключ."
  fi
fi
if [ -z "$API_KEY" ]; then
  echo
  echo "Нужен бесплатный Google API-ключ с включённым PageSpeed Insights API."
  echo "Получить: https://console.cloud.google.com/apis/credentials"
  read -r -s -p "Вставьте PSI API key: " API_KEY
  echo
fi
if [ -z "$API_KEY" ]; then
  echo "ОШИБКА: пустой ключ." >&2
  exit 1
fi

# 3. Сохранение ключа
printf '%s' "$API_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"
echo "   ключ сохранён в $KEY_FILE (chmod 600)"

# 4. Быстрая проверка ключа через реальный запрос
echo "== Проверка ключа на реальном запросе =="
if node "$SERVER" --selftest "$API_KEY" 2>/dev/null; then
  echo "   ключ рабочий."
else
  echo "   ПРЕДУПРЕЖДЕНИЕ: проверка не прошла (возможно, лимит/сеть). Ключ всё равно сохранён." >&2
fi

# 5. Регистрация в Claude Code (user scope)
if [ "$CLAUDE_OK" = "1" ]; then
  echo "== Регистрация MCP-сервера '$MCP_NAME' (user scope) =="
  claude mcp remove "$MCP_NAME" --scope user >/dev/null 2>&1 || true
  claude mcp add "$MCP_NAME" --scope user -- node "$SERVER"
  echo
  echo "Готово. Перезапустите сессию Claude Code — появятся инструменты mcp__${MCP_NAME}__*"
else
  echo
  echo "Ключ сохранён. Зарегистрируйте сервер вручную:"
  echo "  claude mcp add $MCP_NAME --scope user -- node $SERVER"
fi
