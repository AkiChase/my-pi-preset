// Import first in any test that loads the extension entry. The extension pins
// TRELLIS_CONTEXT_ID from the environment at module load, and a Trellis-enabled
// Pi injects it into every bash call, so tests run from such a session would
// otherwise inherit the caller's key. Tests that need a pinned key set it explicitly.
delete process.env.TRELLIS_CONTEXT_ID;
