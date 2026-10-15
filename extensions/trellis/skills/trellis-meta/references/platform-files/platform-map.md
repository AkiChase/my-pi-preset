# Platform Map

Ownership: package extensions plus runtime/skill/role/template sources; project `.trellis/scripts`, `.pi/agents` and `.pi/skills/trellis-*` deployed copies and .trellis state/config/workflow/spec. Deployed skills follow Pi project skill settings (top-level `skills` patterns are relative to `.pi`); package entry filters do not control them. Pi project package entries override personal ones; autoload:false is a filtering delta, not unconditional disable.
