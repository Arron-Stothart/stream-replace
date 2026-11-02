# Stream Replace

Utilities for parsing and transforming streamed text. Especially useful for LLM responses, where text arrives in arbitrary chunks and must be interpreted or transformed:

- Extracting content between structural markers (e.g., `<tool_call>` or `<scratch_pad>`) and emitting it as typed events.
- Parsing responses that mix free-form text with structured fragments.
- Replacing literals or pattern matches with dynamically generated content (e.g., resolving citations).
