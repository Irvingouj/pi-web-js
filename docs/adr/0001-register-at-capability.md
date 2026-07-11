# Register capabilities where they run

Content-script (and other) tools are declared with a single **register** call at the site that can implement them: name, description, Zod params/returns, optional handler, and an explicit **surfaces** list (`page` and/or `web.tab`). The registry pipeline owns manifest, QuickJS exposure, and transport; authors do not maintain parallel page-specs / tab-specs tables or main-thread stub handlers for content-script work.

**Declared params** (agents + apiDocs) may optionally differ from **handler params** (what the content-script handler receives after pipeline rewrites such as `set_files`); default is one schema for both. Project-owned register calls use named Zod schemas only — no `unknown` / `z.unknown()` at that boundary; opaque `NativeArgs` stay on the Chrome parity edge.

We rejected dual mirrored catalogs and a separate “verb table” product artifact: they duplicated truth and forced docs/params to drift. One register + surfaces keeps a small interface; depth stays in the pipeline and handlers.
