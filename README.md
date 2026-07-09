# Speed Insights MCP

Переносимый MCP-сервер, который отдаёт ИИ-агенту (Claude Code) структурированные
данные PageSpeed Insights — те же, что показывает https://pagespeed.web.dev/
(лабораторный Lighthouse + полевые данные CrUX). Node, без внешних зависимостей.

## Установка на новой машине

```bash
git clone/скопировать эту папку, затем:
cd speed_insights
./install.sh          # спросит Google API-ключ, сохранит и зарегистрирует сервер
```

Установщик:
1. проверяет Node (нужен 18+) и CLI `claude`;
2. запрашивает **PageSpeed Insights API key** (или берёт из `PSI_API_KEY`);
3. сохраняет ключ в `./.psi_key` (chmod 600);
4. проверяет ключ реальным запросом (`server.mjs --selftest`);
5. регистрирует сервер в Claude Code: `claude mcp add psi --scope user -- node .../server.mjs`.

После установки **перезапустите сессию Claude Code** — появятся инструменты
`mcp__psi__*`.

Получить бесплатный ключ (25 000 запросов/день):
https://console.cloud.google.com/apis/credentials → Create credentials → API key,
затем включить *PageSpeed Insights API* в библиотеке API.

## Инструменты

| Инструмент | Что делает | Параметры |
|---|---|---|
| `psi_audit` | Полный аудит: баллы + CWV + CrUX + топ проблем + проваленные аудиты | `url`, `strategy` (mobile/desktop) |
| `psi_scores` | Только 4 балла (perf/a11y/bp/seo) — быстро по пачке URL | `url`, `strategy` |
| `psi_core_web_vitals` | Только Core Web Vitals (лаб + поле CrUX) | `url`, `strategy` |
| `psi_compare` | Mobile vs desktop бок о бок (2 запроса) | `url` |

Возвращают структурированный JSON. `strategy` по умолчанию `mobile` (Google mobile-first).

## Ключ

Читается по приоритету: `PSI_API_KEY` (env) → `./.psi_key` → `~/.psi_key`.
Сменить ключ — перезаписать `./.psi_key` или перезапустить `./install.sh`.

## Обслуживание

- Проверить регистрацию: `claude mcp list` → `psi ✓ Connected`.
- Убрать: `claude mcp remove psi --scope user`.
- Ручной тест: `printf '<json-rpc>\n' | node server.mjs` (примеры в шапке server.mjs).
