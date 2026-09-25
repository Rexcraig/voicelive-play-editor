#!/usr/bin/env python3
"""Build the browser-only editor into web/public/vlp/, ready for `wrangler deploy`.

    python3 tools/build_web.py

The UI files in static/ are shared with the desktop version and are copied unchanged: the only
differences are in index.html (module loader, no server) and the asset paths, which must be relative
because the site is served from a sub-path (occhiphoto.com/vlp/).
"""
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import spec  # noqa: E402

OUT = ROOT / "web/public/vlp"
UI = ("app.js", "sets.js", "setup.js", "style.css")
SRC = ("api.js", "boot.js", "midi.js", "rig.js", "storage.js", "tch.js", "spec.json")

# Privacy Policy and Terms (web/pages). Operator: Verona Strategic LLC, Florida, like Will's other apps.
# They are only published once LEGAL_CONTACT is set; until then the build leaves them and their links out.
LEGAL_CONTACT = None
LEGAL_EFFECTIVE = "September 25, 2026"
LEGAL_LINKS = '<p class="legal"><a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms</a></p>\n</footer>'

# What the page says before the singer has let the browser reach the pedal.
CONNECT = """
<div id="connect" class="notice connect">
  <div>
    <strong>Connect to the pedal</strong>
    <p></p>
  </div>
  <button class="primary" type="button">Connect</button>
</div>
"""


def index_html():
    html = (ROOT / "static/index.html").read_text()
    html = html.replace('src="/', 'src="./').replace('href="/', 'href="./')
    # The loader must run before app.js, so the UI's first call already has a transport waiting.
    # Module scripts and deferred classic scripts run after parsing, in document order: with defer added,
    # the loader runs before the UI, so the UI's first call already has a transport.
    html = re.sub(r'<script src="\./(app|sets|setup)\.js"></script>', r'<script defer src="./\1.js"></script>', html)
    html = html.replace('<script defer src="./app.js"></script>',
                        '<script type="module" src="./src/boot.js"></script>\n<script defer src="./app.js"></script>')
    html = html.replace("<main id=\"blocks\"></main>", CONNECT.strip() + "\n\n<main id=\"blocks\"></main>")
    # Not for search engines: this is the singer's tool, not a public page.
    html = html.replace("<head>", '<head>\n<meta name="robots" content="noindex, nofollow">', 1)
    if LEGAL_CONTACT:
        html = html.replace("</footer>", LEGAL_LINKS, 1)
    return html


def main():
    if not (ROOT / "web/src/spec.json").exists():
        sys.exit("web/src/spec.json is missing: run tools/gen_spec.py first.")
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "src").mkdir(parents=True)
    (OUT / "index.html").write_text(index_html())
    for name in UI:
        text = (ROOT / "static" / name).read_text()
        if name == "style.css":
            text = text.replace("url('/fonts/", "url('./fonts/").replace('url("/fonts/', 'url("./fonts/')
        (OUT / name).write_text(text)
    for name in SRC:
        shutil.copy2(ROOT / "web/src" / name, OUT / "src" / name)
    shutil.copytree(ROOT / "static/fonts", OUT / "fonts")
    if LEGAL_CONTACT:
        shutil.copy2(ROOT / "web/pages/legal.css", OUT / "legal.css")
        for name in ("privacy.html", "terms.html"):
            text = (ROOT / "web/pages" / name).read_text()
            text = text.replace("{{CONTACT}}", LEGAL_CONTACT).replace("{{EFFECTIVE}}", LEGAL_EFFECTIVE)
            if "{{" in text:
                sys.exit(f"web/pages/{name} still has an unfilled {{{{...}}}} placeholder.")
            (OUT / name).write_text(text)
    # Cloudflare serves _headers from the root of the assets folder; keeps the page out of search results.
    (OUT.parent / "_headers").write_text("/vlp/*\n  X-Robots-Tag: noindex, nofollow\n")
    (OUT / "robots.txt").write_text("User-agent: *\nDisallow: /\n")
    # Only real attributes: a bare "src" inside a path like ./src/boot.js isn't one.
    left = re.findall(r'(?:src|href)="(/[^"]*)|url\((["\']?)(/[^"\')]*)', (OUT / "index.html").read_text())
    if left:
        sys.exit(f"index.html still has absolute paths, which break under /vlp/: {left}")
    files = sum(1 for _ in OUT.rglob("*") if _.is_file())
    print(f"built v{spec.VERSION} into {OUT.relative_to(ROOT)} ({files} files)")


if __name__ == "__main__":
    main()
