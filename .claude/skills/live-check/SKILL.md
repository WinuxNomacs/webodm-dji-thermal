---
name: live-check
description: Check a UI change in a real headless browser against the plugin's dev server (http://localhost:8002), then remove whatever the check created. Use after building or fixing anything visible.
---

# Live browser check

## Login

Log in at `http://localhost:8002/login/` with the dev account the user has given for this machine (kept in the
project memory, never in the repo). Without one, ask the user. Never look for credentials or cookies in files,
transcripts, the database or the environment.

## Driving the browser

Prefer the Playwright MCP tools (`mcp__playwright__*`) when they are loaded. Otherwise, write a Node script in
the scratchpad that loads Playwright from this repo (`require('<repo>/node_modules/playwright')`), launches
Chromium with `headless: true`, logs in, and saves screenshots to the scratchpad. Read the screenshots back to
look at them, and read the page's console messages.

## What to check

- The change itself, on the user's real data where it applies (the thermal task button, the upload, the converted images, the processed task).
- The browser console has no new errors.

## Before

Note what is there already (the projects and tasks): the user works on this
server too. Give everything the check creates a name of its own (e.g. starting "Live check").

## Afterwards

Delete only what the check created (tasks, projects, uploads, users), by those names, through the UI
or the API; never "everything in the project". Compare with what was there before, and say what was checked and
what was removed.
