# Roadmap

| Phase | Feature                                                      | Status      |
|-------|--------------------------------------------------------------|-------------|
| 1     | Core Memories API (CRUD + tags + auth)                       | Done        |
| 2     | Web page for memories (browse, filter, create, resolve)      | Done        |
| 3.1   | LLM Chat endpoint (basic send/receive via pi-coding-agent)   | Done        |
| 3.2   | LLM with memory context (core facts, today's date)           | Done        |
| 3.3   | Multi-turn session persistence                               | Not started |
| 3.4   | Streaming chat responses                                     | Not started |
| 4     | Google Calendar integration (read/create/edit)               | Done        |
| 5.1   | Telegram Bot integration (send/receive, /start, /remember)   | Done        |
| 5.2   | Daily Briefings via Telegram (cron + manual trigger)         | Done        |
| 5.3   | YNAB tools (transactions, payees, splits, approve, etc.)     | Done¹       |
| 5.4   | Telegram /remember command with memory create/list/resolve   | Done        |
| 5.5   | Open-Meteo weather reports as a part of the daily briefing   | Not started |
| 5.6   | Additional scheduled messages as "check-ins" through the day | Not started |
| 5.7   | Home Assistant integration                                   | Not started |

¹ YNAB tools are implemented but not yet exposed through any user-facing endpoint.
