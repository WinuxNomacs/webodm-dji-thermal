---
name: docs
description: Update the DJI Thermal Analyzer plugin's documentation (docs/) and retake its screenshots with dev/screenshots.js, checking none shows where a flight was. Use after any change to what a user sees, before merging it.
---

# The documentation

`docs/` is Markdown that reads on github.com and on GitHub Pages (`main` `/docs`, Jekyll with `docs/_config.yml`;
no workflow of ours). Link pages relatively (`measurement.md`, `images/x.png`); no definition lists or other
kramdown-only syntax, which github.com shows as text.

- `index.md`: what the plugin does, and the list of pages. A new page is linked from it.
- Quickstarts (`quickstart-*.md`): one task from start to finish, a screenshot per step.
- Guides (`installing.md`, `measurement.md`, `palettes.md`, `dji-sdk.md`) and reference (`converted-images.md`,
  `troubleshooting.md`, `api.md`).

`README.md` stays the short public page and links to `docs/index.md`; a feature change updates both.

## After a change a user sees

1. Update the page that describes it (and `troubleshooting.md` for a new message, `api.md` for a new endpoint).
2. Retake the screenshots it changes (`splash.png`, at the top of README and `index.md`, is the user's own and
   isn't retaken), with the dev stack up (`dev/webodm.sh ps`):
   `node dev/screenshots.js <name> ...` (no name: all of them; an unknown name lists them). It reads
   `DT_DOCS_USER`, `DT_DOCS_PASSWORD`, `DT_DOCS_DATASET`, `DT_DOCS_MAP` and `DT_FLIGHT_DIR` from the environment or
   `.env` (see the script's header). Pass the login on the command line from what the user gave; never write it in
   a tracked file. A new screenshot is a new entry in the script's `SHOTS`, named after the page it shows.
3. **Look at every screenshot before committing it** (read the PNG). None may show where a flight was: no
   coordinates (the script hides the detail pane's latitude and longitude, and refuses a page showing a number
   with 5+ decimals), no address or place name (dataset, project and task names included), no basemap (the
   script blocks every request outside WebODM, so maps show grey around the photos). Nor a camera's serial number
   (hidden by the script). A shot the script can't make safe is left out, and the page says so in words.
4. The script is read only: it lets only GETs through, plus the login, `describe` and an Inspector region's
   statistics, and logs anything it blocked. Pins and regions stay in its own browser profile, gone when it
   closes. Nothing to clean up on the server.
5. Check the links (prints nothing when every link and image is there):
   ```bash
   for f in docs/*.md; do grep -o "](\([^)#:]*\))" "$f" | sed "s/^](//; s/)$//" | while read -r l; do [ -e "docs/$l" ] || echo "$f: $l is missing"; done; done
   ```
   and that every screenshot is used: `comm -3 <(ls docs/images) <(grep -oh "images/[a-z-]*\.png" docs/*.md | sed 's|images/||' | sort -u)`.
