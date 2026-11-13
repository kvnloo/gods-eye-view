- Add Claude as a typed-chat AI Provider. It answers in chat only through
  `/api/anthropic/chat` with `ANTHROPIC_API_KEY` and `ANTHROPIC_CHAT_MODEL`
  (default `claude-haiku-5-5`); with Claude selected, the mic button opens chat
  instead of starting voice (thenekas, #1590).
- Refuse Claude tool calls unless the reply stopped for `tool_use`, so
  truncated replies cannot trigger map actions (thenekas, #1590).
