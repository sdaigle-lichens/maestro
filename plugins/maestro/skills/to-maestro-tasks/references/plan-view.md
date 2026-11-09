# Plan view

A single, self-contained HTML page that explains a plan or one task visually. Build it by filling in the skeleton below with the Write tool; there is no renderer script.

## When

- **Only on request**: the user asks to explain, show or visualize a plan, an epic list or a task.
- **During a plan review**: offer it once at each gate, in one line (`references/plan-review.md`). Never offer it in an ordinary run.

## Where

Write the page to the **repository-root** `.claude/maestro-tasks/views/`:

- review mode: `<epic-slug or plan-slug>-review.html`;
- single-task mode: `<task file name without .md>.html`, e.g. `012-add-login-form.html`.

Writing the same name again replaces the page. Do not write it under `.claude/maestro_sessions/<session>/`: the final end of a session deletes that directory, while the user may still have the page open or want it during the next session. `.claude/maestro-tasks/views/` is not removed by any hook, and the task tracker reads only the `.md` files directly in `.claude/maestro-tasks/`, so a page there is never taken for a task. The user deletes the folder when they no longer need it. A committed-mode install ignores it in git (`**/.claude/maestro-tasks/views/` in the `# Maestro` `.gitignore` block), so a page never shows up as an untracked file.

Then print the page's absolute path and nothing else about it: the user opens it in a browser.

## Fill-in rules

- **Self-contained.** Inline CSS only. No `<script>`, no external stylesheet, font, image or link to anything outside the page.
- **Read-only.** No form, button or input. Every choice stays in the terminal, by ID (`F3`, `D2`, a task number or title): the page shows the IDs to use.
- **Verbatim.** The reviewer's text, the planner's positions, the user's comments, acceptance criteria and option texts are copied exactly. Never summarise one side and quote the other.
- **Escape** every copied text: `&` as `&amp;`, `<` as `&lt;`, `>` as `&gt;`. Keep line breaks with `<br>` or a `<pre>` block.
- **Leave out a section with nothing in it**, rather than showing it empty. Repeat a `<!-- repeat -->` block once per item; remove the comments.
- **Ids for anchors**: `F<n>` for a finding, `D<n>` for an open decision, `T-<number or draft index>` for a task, `E-<slug>` for an epic, so a blocker or finding can link to `#T-012`.

## Skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{TITLE}}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 75rem; padding: 0 1rem; color: #1d1d1f; background: #fff; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #ddd; }
  .muted { color: #666; } .id { font-family: ui-monospace, monospace; font-weight: 600; }
  .layers { display: flex; gap: 1rem; overflow-x: auto; align-items: flex-start; }
  .layer { min-width: 14rem; flex: 1; } .layer > h3 { font-size: .85rem; color: #666; margin: 0 0 .5rem; }
  .card { border: 1px solid #ccc; border-radius: 6px; padding: .5rem .75rem; margin-bottom: .5rem; background: #fafafa; }
  .card.epic { border-left: 4px solid #4a6cf7; } .card.deferred { border-style: dashed; }
  .side { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; } .side > div { border: 1px solid #ddd; border-radius: 6px; padding: .75rem; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; vertical-align: top; }
  .status { font-size: .8rem; padding: .1rem .4rem; border-radius: 4px; background: #eee; }
  .disputed { background: #ffe1d6; } .agreed { background: #dff3e1; } .open { background: #fff4c2; }
  pre { white-space: pre-wrap; margin: 0; font: inherit; }
</style>
</head>
<body>
<h1>{{TITLE}}</h1>
<p class="muted">{{MODE}} · generated {{DATE}} · read-only: answer in the terminal using the IDs shown.</p>

<!-- REVIEW MODE: the sections below, in this order -->
<h2>Dependency graph</h2>
<div class="layers">
  <!-- repeat: one layer per dependency depth (0 = no blocker) -->
  <div class="layer"><h3>Layer {{N}}</h3>
    <!-- repeat: one card per epic or task in this layer -->
    <div class="card {{epic|deferred}}" id="{{ANCHOR}}"><span class="id">{{ID}}</span> {{TITLE}}<br>
      <span class="muted">blocked by: {{LINKED BLOCKER IDS or "none"}}</span></div>
  </div>
</div>

<h2>Coverage</h2>
<table><tr><th>Spec item</th><th>Covered by</th><th>Note</th></tr>
  <!-- repeat --><tr><td>{{ITEM}}</td><td>{{EPIC OR TASK IDS}}</td><td>{{"none" | "two owners" | empty}}</td></tr>
</table>

<h2>Both plans</h2>
<div class="side">
  <div><h3>Reviewer's blind sketch</h3><pre>{{SKETCH, VERBATIM}}</pre></div>
  <div><h3>Planner's draft</h3><pre>{{DRAFT OUTLINE: each epic or task with its goal and blockers}}</pre></div>
</div>

<h2>Findings</h2>
<table><tr><th>ID</th><th>Reviewer</th><th>Planner</th><th>User</th><th>Status</th></tr>
  <!-- repeat --><tr id="F{{N}}"><td class="id">F{{N}}</td><td><pre>{{REVIEWER TEXT, VERBATIM}}</pre></td>
    <td><pre>{{PLANNER POSITION AND REASON, VERBATIM}}</pre></td><td><pre>{{USER COMMENT, VERBATIM, or empty}}</pre></td>
    <td><span class="status {{agreed|disputed}}">{{agreed|disputed|withdrawn}}</span></td></tr>
</table>

<h2>Open decisions</h2>
<!-- repeat -->
<div class="card" id="D{{N}}"><span class="id">D{{N}}</span> {{QUESTION}} <span class="status open">open</span>
  <ol><!-- repeat --><li>{{OPTION, VERBATIM}}</li></ol>
  <span class="muted">from: {{LINKED FINDING IDS}}</span></div>

<!-- SINGLE-TASK MODE: the sections below instead -->
<h2>Goal</h2>
<p>{{WHAT TO BUILD, VERBATIM}}</p>
<h2>Blocked by</h2>
<ul><!-- repeat --><li><span class="id">{{TASK}}</span> {{TITLE}} <span class="status">{{STATUS}}</span></li></ul>
<h2>Touched surfaces</h2>
<ul><!-- repeat --><li>{{SURFACE, VERBATIM}}</li></ul>
<h2>Acceptance criteria</h2>
<ul><!-- repeat --><li>{{CRITERION, VERBATIM}}</li></ul>
<h2>Open options</h2>
<!-- repeat -->
<div class="card" id="D{{N}}"><span class="id">D{{N}}</span> {{QUESTION}}<ol><!-- repeat --><li>{{OPTION}}</li></ol></div>
</body>
</html>
```

## Review mode

Use it during a plan review, or for an unwritten plan the user asks to see.

- **Dependency graph**: every epic, and every task draft once Gate 2 has drafts, placed in the layer of its longest blocker chain. A task's blockers are linked by anchor; a blocker in another epic shows that task's title until it has a file name. Deferred epics get the `deferred` class.
- **Coverage**: the coverage check from `epics.md` (or, for one epic, its `Covers` items against its tasks).
- **Both plans**: the reviewer's blind sketch verbatim on the left, the planner's current draft on the right. Before any review exists, leave this section out.
- **Findings**: every finding of the run by ID, with both positions verbatim, the user's comment when there is one, and the status.
- **Open decisions**: every disputed finding or other question waiting for the user, with its options, numbered `D1`, `D2`, ...

## Single-task mode

Use it to explain one task, drafted or already written. For a written task, read its file in `.claude/maestro-tasks/`: `## What to build` is the goal, `## Blocked by` the blockers (with each one's status from `.claude/maestro-tasks/status.json`), `## Touched surfaces` and `## Acceptance criteria` as written. **Open options** are the choices the task leaves to the builder or marks as assumed or unverified; leave the section out when there are none.
