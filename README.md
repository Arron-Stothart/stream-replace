# Stream Replace

Utilities for parsing and transforming streamed text.

Especially useful for LLM responses, where text arrives in arbitrary chunks and needs to be interpreted or transformed:

- Extracting content from structural markers and emitting typed events (e.g., `<tool_call>` or `<scratch_pad>`).
- Replacing literals or matched patterns with dynamically generated content (e.g. validating citations).
