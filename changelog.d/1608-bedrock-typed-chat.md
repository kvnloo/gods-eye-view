- Add Amazon Bedrock as a typed-chat AI Provider. It sends the Converse API
  through `/api/bedrock/chat` with a Bedrock API key in
  `AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_REGION` (default `us-east-1`) and
  `BEDROCK_CHAT_MODEL` (default `global.anthropic.claude-haiku-5-5`), chat
  only; with Amazon Bedrock selected, the mic button opens chat instead of
  starting voice (thenekas, #1608).
- Omit older reasoning-only Bedrock turns when signed reasoning must be
  dropped from replayed history, keeping the remaining message roles paired
  (thenekas, #1608).
