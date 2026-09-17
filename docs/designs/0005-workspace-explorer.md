# Workspace explorer

The VS Code Activity Bar view becomes the primary navigation. The editor hides its
second sidebar. A native tree exposes Overview, Favourites, Tables, Import data,
Activity and Settings. Expanding Tables lazily starts the bundled service and
loads metadata; merely activating the view does not contact AWS. Selecting a
table opens its item view in the existing editor. Children link to saved queries,
schema/indexes, Streams, data model, PartiQL and management. Settings expand to
connection/access, saved workspace and startup sections.

The browser and desktop use the same hierarchy and route model. Table favourites
are scoped to AWS account/region or local endpoint/region. Saved query definitions
remain scoped to the same connection and table. Installed apps keep both in their
host-owned workspace.sqlite3, with revisions and transactional writes; the browser
uses local storage. Workspace JSON export/import includes favourites, queries and
schemas, preserving existing definitions. No credentials or table contents are
exported; query filter values may still be sensitive. Each host keeps its own
workspace and users explicitly export/import between hosts.

Native tree navigation carries its connection ID so stale nodes cannot operate on
a newly selected connection. Open dialogs block navigation. Saved query links
validate the saved schema and load controls for review without executing a scan;
Run query remains explicit. Table opening retains the existing first-page read.
Native refresh clears obsolete nodes and surfaces connection failures with a
settings shortcut. No mutation is performed by expanding tree sections.
