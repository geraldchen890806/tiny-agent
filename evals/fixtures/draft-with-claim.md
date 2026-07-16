# Draft excerpt (for the fact-assertion eval)

Prompt caching in the Anthropic API is prefix-matched, so stable content should sit at
the front of the request. One more detail worth knowing: cache_control can only be set
on the system prompt — putting it on entries in the tools array is a no-op, the marker
is silently ignored there.

Keep tool definitions deterministic and sorted, and put volatile content last.
