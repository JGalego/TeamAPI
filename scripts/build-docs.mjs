#!/usr/bin/env node
// Builds a versioned documentation site from the repository's own markdown.
//
//   node scripts/build-docs.mjs --out site-out/latest --label latest
//   node scripts/build-docs.mjs --out site-out/v0.5 --label v0.5 --source /tmp/worktree
//
// The README is 60KB of prose that answers every question this project has, and it answers them in
// one scroll with no navigation — which means it is read once, by whoever is installing, and never
// again. This turns it and everything under docs/ into pages with a sidebar, search, per-page
// tables of contents and stable heading anchors, and stamps a version on the result so a reader on
// 0.4 is not being told about a flag that shipped in 0.6.
//
// Deliberately not a framework. A docs site that needs a build toolchain to survive is a docs site
// that stops building the first time somebody upgrades Node, and the whole content set here is
// markdown files that already exist. `marked` renders them; everything else is string
// concatenation and the CSS inherited from the landing page.
//
// The one external request the pages make is mermaid from jsDelivr, and only on pages that
// actually contain a diagram. The alternative was rendering diagrams at build time, which needs a
// headless browser in the build — the exact toolchain this script refuses to become. If the CDN
// is unreachable the diagram source stays visible as text, which is what GitHub showed for years.

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const source = resolve(flag("source", REPO));
const outDir = resolve(flag("out", join(REPO, "site-out", "latest")));
const label = flag("label", "latest");

/** Every page the site is built from, in sidebar order. */
function collectPages() {
  const pages = [{ src: "README.md", out: "index.html", title: "Overview", group: "Start here" }];

  const spec = "docs/spec/teamapi-extended-v1.md";
  if (existsSync(join(source, spec))) {
    pages.push({ src: spec, out: "spec.html", title: "Specification", group: "Start here" });
  }
  for (const name of ["deployment.md", "code-quality.md"]) {
    if (existsSync(join(source, "docs", name))) {
      pages.push({
        src: `docs/${name}`,
        out: `${name.replace(/\.md$/, "")}.html`,
        title: titleCase(name.replace(/\.md$/, "")),
        group: "Start here",
      });
    }
  }

  const integrationsDir = join(source, "docs", "integrations");
  if (existsSync(integrationsDir)) {
    for (const name of readdirSync(integrationsDir).sort()) {
      if (!name.endsWith(".md")) continue;
      pages.push({
        src: `docs/integrations/${name}`,
        out: `integrations/${name.replace(/\.md$/, "")}.html`,
        title: titleCase(name.replace(/\.md$/, "")),
        group: "Integrations",
      });
    }
  }

  const packagesDir = join(source, "packages");
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir).sort()) {
      const readme = join(packagesDir, name, "README.md");
      if (!existsSync(readme)) continue;
      pages.push({
        src: `packages/${name}/README.md`,
        out: `packages/${name}.html`,
        title: name,
        group: "Packages",
      });
    }
  }

  return pages;
}

function titleCase(slug) {
  const special = { opentelemetry: "OpenTelemetry", codeowners: "CODEOWNERS", pagerduty: "PagerDuty", okta: "Okta" };
  return (
    special[slug] ?? slug.replace(/(^|[-/])([a-z])/g, (_, sep, ch) => (sep === "-" ? " " : sep) + ch.toUpperCase())
  );
}

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * GitHub's heading-anchor algorithm, because the documents were written against it.
 *
 * The spec's own table of contents links to `#root-object`; the README hand-embeds matching
 * anchors. marked used to generate these ids and silently stopped in v5 when the option was
 * removed, which left the spec page with thirty-four internal links and nothing to land on.
 * Generating anything other than GitHub's exact slugs would break those hand-written links a
 * second way.
 */
function githubSlug(text, seen) {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
  const n = seen.get(slug) ?? 0;
  seen.set(slug, n + 1);
  return n === 0 ? slug : `${slug}-${n}`;
}

/** Per-page state the custom renderer fills in while marked walks the document. */
const pageState = { slugs: new Map(), toc: [], hasMermaid: false };

const renderer = {
  heading({ tokens, depth }) {
    const inline = this.parser.parseInline(tokens);
    const plain = this.parser
      .parseInline(tokens)
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const slug = githubSlug(plain, pageState.slugs);
    if (depth === 2 || depth === 3) pageState.toc.push({ depth, text: plain, slug });
    // The trailing pilcrow-style link makes every section addressable without knowing the slug
    // convention; visible only on hover/focus so it never competes with the heading itself.
    const anchor = depth > 1 ? `<a class="hl" href="#${slug}" aria-label="Link to “${escapeHtml(plain)}”">#</a>` : "";
    return `<h${depth} id="${slug}">${inline}${anchor}</h${depth}>\n`;
  },
  code({ text, lang }) {
    if (lang !== "mermaid") return false; // fall through to marked's default renderer
    pageState.hasMermaid = true;
    return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
  },
};

marked.use({ gfm: true, renderer });

/**
 * Rewrites the links markdown written for a repository into links that work on a site.
 *
 * The source files link at each other by repository path (`docs/integrations/slack.md`,
 * `packages/cli`), which is right for someone reading on GitHub and broken everywhere else. This
 * is the one piece of real work in the build: without it every cross-reference in a 60KB README
 * 404s, and a docs site whose internal links do not work is worse than the README it replaced.
 */
function rewriteLinks(html, page, pages) {
  const bySource = new Map(pages.map((entry) => [entry.src, entry.out]));
  const depth = page.out.split("/").length - 1;
  const prefix = depth === 0 ? "" : "../".repeat(depth);

  return html.replace(/href="([^"]+)"/g, (whole, href) => {
    if (/^(https?:|mailto:|#)/.test(href)) return whole;

    const clean = href.replace(/^\.\//, "");
    const [path, fragment] = clean.split("#");
    const hash = fragment ? `#${fragment}` : "";
    // A link to a directory holding a README — `packages/cli` — means that README's page.
    const target = bySource.get(path) ?? bySource.get(`${path.replace(/\/$/, "")}/README.md`);
    if (target) return `href="${prefix}${target}${hash}"`;

    // Anything else is a repository path with no page of its own (a source file, an example);
    // send it to GitHub rather than leaving a dead link.
    return `href="https://github.com/JGalego/TeamAPI/blob/main/${clean}"`;
  });
}

function sidebar(pages, current, prefix, versions) {
  const groups = [...new Set(pages.map((page) => page.group))];
  const otherVersions = versions.filter((v) => v !== label);

  const nav = groups
    .map((group) => {
      const items = pages
        .filter((page) => page.group === group)
        .map(
          (page) =>
            `<li><a href="${prefix}${page.out}"${page.out === current.out ? ' aria-current="page"' : ""}>${page.title}</a></li>`,
        )
        .join("\n");
      return `<h3>${group}</h3>\n<ul>${items}</ul>`;
    })
    .join("\n");

  return `${nav}
<h3>Elsewhere</h3>
<ul>
  <li><a href="https://github.com/JGalego/TeamAPI">GitHub</a></li>
  <li><a href="https://www.npmjs.com/package/@jgalego/teamapi">npm</a></li>
  <li><a href="${prefix}../index.html">Landing page</a></li>
</ul>
${otherVersions.length ? `<h3>Versions</h3>\n<ul>${otherVersions.map((v) => `<li><a href="${prefix}../${v}/index.html">${v}</a></li>`).join("\n")}</ul>` : ""}`;
}

function tocHtml(toc) {
  if (toc.length < 2) return { rail: "", inline: "" };
  const items = toc
    .map(
      (entry) =>
        `<li${entry.depth === 3 ? ' class="sub"' : ""}><a href="#${entry.slug}">${escapeHtml(entry.text)}</a></li>`,
    )
    .join("\n");
  return {
    rail: `<aside class="toc" aria-label="On this page"><h3>On this page</h3><ol>${items}</ol></aside>`,
    inline: `<details class="onpage"><summary>On this page</summary><ol>${items}</ol></details>`,
  };
}

function pager(pages, current, prefix) {
  const index = pages.findIndex((page) => page.out === current.out);
  const prev = pages[index - 1];
  const next = pages[index + 1];
  if (!prev && !next) return "";
  const cell = (page, dir) =>
    page
      ? `<a class="${dir}" href="${prefix}${page.out}"><small>${dir === "prev" ? "← Previous" : "Next →"}</small>${page.title}</a>`
      : "<span></span>";
  return `<nav class="pager" aria-label="Adjacent pages">${cell(prev, "prev")}${cell(next, "next")}</nav>`;
}

/** Colour tokens and the theme toggle are lifted from the landing page, so the docs are visibly
 * the same site rather than a second one that happens to be linked. */
const STYLE = `
  :root {
    --bg:#fff; --fg:#1e293b; --muted:#64748b; --card:#f8fafc; --line:#e2e8f0; --accent:#14b8a6;
    --top-h: 3.25rem;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg:#0b0f16; --fg:#e6edf3; --muted:#8b98a9; --card:#131922; --line:#222b38; --accent:#2dd4bf;
    }
  }
  :root[data-theme="dark"] {
    --bg:#0b0f16; --fg:#e6edf3; --muted:#8b98a9; --card:#131922; --line:#222b38; --accent:#2dd4bf;
  }
  * { box-sizing: border-box; }
  html { scroll-padding-top: calc(var(--top-h) + 1rem); }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.7 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  a { color: var(--accent); }

  /* ---- top bar ---- */
  .top {
    position: sticky; top: 0; z-index: 20; height: var(--top-h);
    display: flex; align-items: center; gap: .6rem; padding: 0 .9rem;
    background: var(--bg); border-bottom: 1px solid var(--line);
  }
  .top .brand { display:flex; align-items:center; gap:.45rem; font-weight:600; text-decoration:none; color:var(--fg); white-space:nowrap; }
  .version { font-size:.72rem; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:.05rem .5rem; white-space:nowrap; }
  .top button {
    background:none; border:1px solid var(--line); color:var(--muted); border-radius:8px;
    padding:.3rem .55rem; cursor:pointer; font:inherit; font-size:.85rem; line-height:1;
  }
  .top button:hover { color: var(--fg); }
  #menu { display:none; }
  .search { position:relative; flex:1; max-width:26rem; margin-left:auto; }
  .search input {
    width:100%; padding:.35rem .7rem; font:inherit; font-size:.85rem;
    color:var(--fg); background:var(--card); border:1px solid var(--line); border-radius:8px;
  }
  .search input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  #results {
    position:absolute; top:calc(100% + .35rem); left:0; right:0; z-index:30;
    background:var(--bg); border:1px solid var(--line); border-radius:10px;
    max-height:min(24rem, 70vh); overflow-y:auto; box-shadow:0 12px 32px rgb(0 0 0 / .18);
  }
  #results a { display:block; padding:.45rem .75rem; text-decoration:none; color:var(--fg); font-size:.85rem; border-top:1px solid var(--line); }
  #results a:first-child { border-top:none; }
  #results a small { display:block; color:var(--muted); }
  #results a.active, #results a:hover { background:var(--card); }
  #results .none { display:block; padding:.45rem .75rem; color:var(--muted); font-size:.85rem; }

  /* ---- shell ---- */
  .shell {
    display:grid; grid-template-columns: 16rem minmax(0,1fr); gap:2.5rem;
    max-width:76rem; margin:0 auto; padding:0 1.25rem 4rem;
  }
  nav.side {
    position:sticky; top:var(--top-h); align-self:start;
    max-height:calc(100vh - var(--top-h)); overflow-y:auto;
    padding:1.25rem 0 2rem; font-size:.9rem;
  }
  nav.side h3 { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:1.4rem 0 .4rem; }
  nav.side h3:first-child { margin-top:0; }
  nav.side ul { list-style:none; margin:0; padding:0; }
  nav.side li a { display:block; padding:.22rem .5rem; margin-left:-.5rem; border-radius:6px; color:var(--fg); text-decoration:none; }
  nav.side li a:hover { color:var(--accent); background:var(--card); }
  nav.side li a[aria-current="page"] { color:var(--accent); font-weight:600; }
  #backdrop { display:none; }

  /* ---- article ---- */
  /* break-word so a slash-chained token or bare URL wraps instead of widening the page — on a
     phone one such word is the difference between a readable page and sideways scrolling */
  article { padding:1.5rem 0; min-width:0; overflow-wrap:break-word; }
  article h1 { margin-top:0; font-size:1.9rem; line-height:1.25; }
  article h2 { margin-top:2.4rem; padding-top:.5rem; border-top:1px solid var(--line); }
  /* No scroll-margin here: html's scroll-padding-top already clears the sticky header, and the
     two are additive — both at once lands every anchor a full header-height too low. */
  article h2, article h3 { position:relative; }
  .hl { margin-left:.4rem; text-decoration:none; opacity:0; font-weight:400; }
  h2:hover .hl, h3:hover .hl, .hl:focus { opacity:1; }
  article img { max-width:100%; height:auto; }
  article pre { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.9rem 1rem; overflow-x:auto; font-size:.88em; }
  article pre.mermaid { text-align:center; }
  article :not(pre) > code { background:var(--card); border:1px solid var(--line); border-radius:4px; padding:.05rem .3rem; font-size:.88em; overflow-wrap:anywhere; }
  article table { border-collapse:collapse; display:block; overflow-x:auto; max-width:100%; }
  article th, article td { border:1px solid var(--line); padding:.35rem .6rem; text-align:left; font-size:.9rem; }
  article thead th { background:var(--card); }
  /* Tables already scroll sideways, so a code token in a cell never needs to shatter mid-word —
     "teamApiVersion" broken across four lines is worse than a wider column. */
  article table code { overflow-wrap:normal; white-space:nowrap; }
  article blockquote { border-left:3px solid var(--accent); margin-left:0; padding-left:1rem; color:var(--muted); }
  .banner { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.6rem .9rem; font-size:.88rem; margin-bottom:1.5rem; }

  /* ---- on this page ---- */
  .toc { display:none; }
  details.onpage { margin:0 0 1.5rem; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.5rem .9rem; font-size:.88rem; }
  details.onpage summary { cursor:pointer; color:var(--muted); }
  details.onpage ol, .toc ol { list-style:none; margin:.4rem 0 .2rem; padding:0; }
  details.onpage li a, .toc li a { display:block; padding:.14rem 0; color:var(--fg); text-decoration:none; }
  details.onpage li a:hover, .toc li a:hover { color:var(--accent); }
  details.onpage li.sub, .toc li.sub { padding-left:.9rem; }

  /* ---- prev/next ---- */
  .pager { display:grid; grid-template-columns:1fr 1fr; gap:.8rem; margin-top:3rem; }
  .pager a {
    display:block; padding:.6rem .9rem; border:1px solid var(--line); border-radius:10px;
    text-decoration:none; color:var(--fg); font-weight:600; font-size:.92rem;
  }
  .pager a:hover { border-color:var(--accent); }
  .pager a small { display:block; font-weight:400; color:var(--muted); }
  .pager a.next { text-align:right; }

  /* ---- wide: right-hand mini-TOC ---- */
  @media (min-width: 85rem) {
    .shell { grid-template-columns: 16rem minmax(0,1fr) 13rem; max-width:90rem; }
    .toc {
      display:block; position:sticky; top:var(--top-h); align-self:start;
      max-height:calc(100vh - var(--top-h)); overflow-y:auto;
      padding:1.5rem 0; font-size:.82rem;
    }
    .toc h3 { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 .4rem; }
    details.onpage { display:none; }
  }

  /* ---- narrow: off-canvas navigation ---- */
  @media (max-width: 60rem) {
    .shell { grid-template-columns: 1fr; gap:0; }
    #menu { display:inline-block; }
    nav.side {
      position:fixed; top:0; bottom:0; left:0; z-index:40;
      width:min(19rem, 85vw); max-height:none;
      background:var(--bg); border-right:1px solid var(--line);
      padding:1.25rem 1.25rem 2rem; margin:0;
      transform:translateX(-105%); transition:transform .2s ease;
    }
    @media (prefers-reduced-motion: reduce) { nav.side { transition:none; } }
    body.nav-open nav.side { transform:translateX(0); }
    body.nav-open #backdrop { display:block; position:fixed; inset:0; z-index:35; background:rgb(0 0 0 / .45); }
    body.nav-open { overflow:hidden; }
    .version { display:none; }
  }
`;

const THEME_SCRIPT = `
  // Set before paint from localStorage, so a reader who chose dark does not get a white flash on
  // every navigation — this site is many small pages, so that flash would happen constantly.
  (function () {
    var saved = localStorage.getItem("teamapi-theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
  })();
`;

/** Navigation drawer, theme toggle, and search. Plain DOM script, inlined so a page is one file. */
const APP_SCRIPT = `
  (function () {
    var body = document.body;
    var menu = document.getElementById("menu");
    var backdrop = document.getElementById("backdrop");
    function closeNav() { body.classList.remove("nav-open"); }
    menu.addEventListener("click", function () { body.classList.toggle("nav-open"); });
    backdrop.addEventListener("click", closeNav);
    document.querySelector("nav.side").addEventListener("click", function (e) {
      if (e.target.closest("a")) closeNav();
    });

    document.getElementById("theme").addEventListener("click", function () {
      var root = document.documentElement;
      var dark = root.getAttribute("data-theme")
        ? root.getAttribute("data-theme") === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      var next = dark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("teamapi-theme", next);
    });

    // Search: an index of every page's title and headings, fetched on first use. Filtering ~300
    // headings in the client is instant and needs no service, which is the whole reason a static
    // site can afford a search box at all.
    var input = document.getElementById("q");
    var results = document.getElementById("results");
    var index = null;
    var active = -1;

    function load() {
      if (index) return Promise.resolve(index);
      return fetch(PREFIX + "search-index.json")
        .then(function (r) { return r.json(); })
        .then(function (data) { index = data; return data; })
        .catch(function () { return []; });
    }

    function hide() { results.hidden = true; active = -1; }

    function render(hits, query) {
      if (!query) return hide();
      results.hidden = false;
      if (!hits.length) { results.innerHTML = '<span class="none">No matches</span>'; return; }
      results.innerHTML = hits.slice(0, 12).map(function (hit) {
        return '<a href="' + PREFIX + hit.url + '"><strong>' + hit.text + "</strong><small>" + hit.page + "</small></a>";
      }).join("");
      active = -1;
    }

    function search(query) {
      load().then(function (data) {
        var q = query.trim().toLowerCase();
        if (!q) return hide();
        var hits = [];
        data.forEach(function (page) {
          if (page.t.toLowerCase().indexOf(q) !== -1) hits.push({ text: page.t, page: page.g, url: page.u });
          page.h.forEach(function (h) {
            if (h.t.toLowerCase().indexOf(q) !== -1) hits.push({ text: h.t, page: page.t, url: page.u + "#" + h.s });
          });
        });
        render(hits, q);
      });
    }

    input.addEventListener("input", function () { search(input.value); });
    input.addEventListener("focus", function () { load(); });
    input.addEventListener("keydown", function (e) {
      var links = results.querySelectorAll("a");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!links.length) return;
        active = e.key === "ArrowDown" ? (active + 1) % links.length : (active - 1 + links.length) % links.length;
        links.forEach(function (l, i) { l.classList.toggle("active", i === active); });
        links[active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && links.length) {
        location.href = links[active === -1 ? 0 : active].href;
      } else if (e.key === "Escape") {
        hide(); input.blur();
      }
    });
    document.addEventListener("click", function (e) { if (!e.target.closest(".search")) hide(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !e.target.closest("input, textarea, select")) { e.preventDefault(); input.focus(); }
      if (e.key === "Escape") closeNav();
    });
  })();
`;

/** Renders mermaid fences on pages that have any. Theme is chosen once at load; toggling the site
 * theme leaves an already-rendered diagram as it is, which beats re-rendering the page under the
 * reader. If the CDN is unreachable the source text stays visible, exactly as GitHub showed it
 * before GitHub rendered mermaid. */
const MERMAID_SCRIPT = `
  import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
    .then(function (m) {
      var root = document.documentElement;
      var dark = root.getAttribute("data-theme")
        ? root.getAttribute("data-theme") === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      m.default.initialize({ startOnLoad: false, theme: dark ? "dark" : "default" });
      m.default.run();
    })
    .catch(function () { /* the diagram source stays readable as text */ });
`;

function page(pages, current, body, versions, toc) {
  const depth = current.out.split("/").length - 1;
  const prefix = depth === 0 ? "" : "../".repeat(depth);
  const parts = tocHtml(toc);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${current.title} — TeamAPI ${label}</title>
<link rel="icon" href="${prefix}../logo.svg" type="image/svg+xml">
<style>${STYLE}</style>
<script>${THEME_SCRIPT}</script>
</head>
<body>
<header class="top">
  <button id="menu" aria-label="Open navigation" aria-controls="sidenav">☰</button>
  <a class="brand" href="${prefix}index.html">🧭 TeamAPI</a>
  <span class="version">${label}</span>
  <div class="search">
    <input id="q" type="search" placeholder="Search docs — press /" autocomplete="off" aria-label="Search documentation">
    <div id="results" hidden></div>
  </div>
  <button id="theme" type="button" aria-label="Toggle color theme">◐</button>
</header>
<div class="shell">
  <nav class="side" id="sidenav" aria-label="Documentation">
    ${sidebar(pages, current, prefix, versions)}
  </nav>
  <div id="backdrop"></div>
  <article>
    ${label === "latest" ? "" : `<div class="banner">You are reading the docs for <strong>${label}</strong>. <a href="${prefix}../latest/${current.out}">Go to the latest version</a>.</div>`}
    ${parts.inline}
    ${body}
    ${pager(pages, current, prefix)}
  </article>
  ${parts.rail}
</div>
<script>var PREFIX = ${JSON.stringify(prefix)};</script>
<script>${APP_SCRIPT}</script>
${pageState.hasMermaid ? `<script type="module">${MERMAID_SCRIPT}</script>` : ""}
</body>
</html>
`;
}

const pages = collectPages();
// Written by the caller (the workflow) once every version is built; read here so a page can link
// to the versions that exist rather than to a hard-coded list.
const versionsFile = join(dirname(outDir), "versions.json");
const versions = existsSync(versionsFile) ? JSON.parse(readFileSync(versionsFile, "utf-8")) : [label];

const searchIndex = [];

for (const entry of pages) {
  pageState.slugs = new Map();
  pageState.toc = [];
  pageState.hasMermaid = false;

  const markdown = readFileSync(join(source, entry.src), "utf-8");
  const html = rewriteLinks(marked.parse(markdown), entry, pages);

  searchIndex.push({
    t: entry.title,
    g: entry.group,
    u: entry.out,
    h: pageState.toc.map((item) => ({ t: item.text, s: item.slug })),
  });

  const file = join(outDir, entry.out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page(pages, entry, html, versions, pageState.toc), "utf-8");
}

writeFileSync(join(outDir, "search-index.json"), JSON.stringify(searchIndex), "utf-8");

// Images the README references by repository path. Copied rather than linked to GitHub so the
// site keeps working for a reader behind a proxy that does not reach raw.githubusercontent.
const assets = join(source, "docs", "assets");
if (existsSync(assets)) cpSync(assets, join(outDir, "docs", "assets"), { recursive: true });

console.log(`Built ${pages.length} page(s) into ${relative(REPO, outDir)} (${label})`);
