#!/usr/bin/env node
// Builds a versioned documentation site from the repository's own markdown.
//
//   node scripts/build-docs.mjs --out site-out/latest --label latest
//   node scripts/build-docs.mjs --out site-out/v0.5 --label v0.5 --source /tmp/worktree
//
// The README is 60KB of prose that answers every question this project has, and it answers them in
// one scroll with no navigation — which means it is read once, by whoever is installing, and never
// again. This turns it and everything under docs/ into pages with a sidebar, and stamps a version
// on the result so a reader on 0.4 is not being told about a flag that shipped in 0.6.
//
// Deliberately not a framework. A docs site that needs a build toolchain to survive is a docs site
// that stops building the first time somebody upgrades Node, and the whole content set here is
// markdown files that already exist. `marked` renders them; everything else is string
// concatenation and forty lines of CSS inherited from the landing page.

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
    // A link to a directory holding a README — `packages/cli` — means that README's page.
    const target = bySource.get(clean) ?? bySource.get(`${clean.replace(/\/$/, "")}/README.md`);
    if (target) return `href="${prefix}${target}"`;

    // Anything else is a repository path with no page of its own (a source file, an example);
    // send it to GitHub rather than leaving a dead link.
    return `href="https://github.com/JGalego/TeamAPI/blob/main/${clean}"`;
  });
}

function sidebar(pages, current) {
  const depth = current.out.split("/").length - 1;
  const prefix = depth === 0 ? "" : "../".repeat(depth);
  const groups = [...new Set(pages.map((page) => page.group))];

  return groups
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
}

/** Colour tokens, spacing and the theme toggle are lifted from the landing page, so the docs are
 * visibly the same site rather than a second one that happens to be linked. */
const STYLE = `
  :root {
    --bg:#fff; --fg:#1e293b; --muted:#64748b; --card:#f8fafc; --line:#e2e8f0; --accent:#14b8a6;
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
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.7 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  a { color: var(--accent); }
  .shell { display:grid; grid-template-columns: 16rem minmax(0,1fr); gap:2.5rem; max-width:76rem; margin:0 auto; padding:0 1.25rem 5rem; }
  nav { position:sticky; top:0; align-self:start; max-height:100vh; overflow-y:auto; padding:1.5rem 0; font-size:.9rem; }
  nav h3 { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:1.4rem 0 .4rem; }
  nav ul { list-style:none; margin:0; padding:0; }
  nav li a { display:block; padding:.2rem 0; color:var(--fg); text-decoration:none; }
  nav li a:hover { color:var(--accent); }
  nav li a[aria-current="page"] { color:var(--accent); font-weight:600; }
  .brand { display:flex; align-items:center; gap:.5rem; font-weight:600; text-decoration:none; color:var(--fg); }
  .version { font-size:.75rem; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:.1rem .5rem; }
  article { padding:1.5rem 0; min-width:0; }
  article h1 { margin-top:0; }
  article h2 { margin-top:2.2rem; padding-top:.4rem; border-top:1px solid var(--line); }
  article img { max-width:100%; }
  article pre { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.9rem 1rem; overflow-x:auto; }
  article :not(pre) > code { background:var(--card); border:1px solid var(--line); border-radius:4px; padding:.05rem .3rem; font-size:.88em; }
  article table { border-collapse:collapse; display:block; overflow-x:auto; max-width:100%; }
  article th, article td { border:1px solid var(--line); padding:.35rem .6rem; text-align:left; font-size:.9rem; }
  article blockquote { border-left:3px solid var(--line); margin-left:0; padding-left:1rem; color:var(--muted); }
  .banner { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.6rem .9rem; font-size:.88rem; margin-bottom:1.5rem; }
  #theme { float:right; background:none; border:1px solid var(--line); color:var(--muted); border-radius:8px; padding:.25rem .6rem; cursor:pointer; font:inherit; font-size:.75rem; }
  @media (max-width: 60rem) {
    .shell { grid-template-columns: 1fr; gap:0; }
    nav { position:static; max-height:none; border-bottom:1px solid var(--line); }
  }
`;

const THEME_SCRIPT = `
  // Set before paint from localStorage, so a reader who chose dark does not get a white flash on
  // every navigation — this site is many small pages, so that flash would happen constantly.
  (function () {
    var saved = localStorage.getItem("teamapi-theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#theme")) return;
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("teamapi-theme", next);
    });
  })();
`;

function page(pages, current, body, versions) {
  const depth = current.out.split("/").length - 1;
  const prefix = depth === 0 ? "" : "../".repeat(depth);
  const otherVersions = versions.filter((v) => v !== label);

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
<div class="shell">
  <nav>
    <p><a class="brand" href="${prefix}index.html">🧭 TeamAPI</a> <span class="version">${label}</span></p>
    ${sidebar(pages, current)}
    <h3>Elsewhere</h3>
    <ul>
      <li><a href="https://github.com/JGalego/TeamAPI">GitHub</a></li>
      <li><a href="${prefix}../index.html">Landing page</a></li>
      ${otherVersions.map((v) => `<li><a href="${prefix}../${v}/index.html">${v}</a></li>`).join("\n      ")}
    </ul>
  </nav>
  <article>
    <button id="theme" type="button">◐ theme</button>
    ${label === "latest" ? "" : `<div class="banner">You are reading the docs for <strong>${label}</strong>. <a href="${prefix}../latest/${current.out}">Go to the latest version</a>.</div>`}
    ${body}
  </article>
</div>
</body>
</html>
`;
}

const pages = collectPages();
// Written by the caller (the workflow) once every version is built; read here so a page can link
// to the versions that exist rather than to a hard-coded list.
const versionsFile = join(dirname(outDir), "versions.json");
const versions = existsSync(versionsFile) ? JSON.parse(readFileSync(versionsFile, "utf-8")) : [label];

marked.setOptions({ mangle: false, headerIds: true, gfm: true });

for (const entry of pages) {
  const markdown = readFileSync(join(source, entry.src), "utf-8");
  const html = rewriteLinks(marked.parse(markdown), entry, pages);
  const file = join(outDir, entry.out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page(pages, entry, html, versions), "utf-8");
}

// Images the README references by repository path. Copied rather than linked to GitHub so the
// site keeps working for a reader behind a proxy that does not reach raw.githubusercontent.
const assets = join(source, "docs", "assets");
if (existsSync(assets)) cpSync(assets, join(outDir, "docs", "assets"), { recursive: true });

console.log(`Built ${pages.length} page(s) into ${relative(REPO, outDir)} (${label})`);
