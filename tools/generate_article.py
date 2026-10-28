#!/usr/bin/env python3
"""
Build A Trust 24 — Trust News & Insights article generator.

WHAT IT DOES (for Madison, in one read):
  Paste a ruling or news item into a small JSON file in tools/articles/,
  run this script, and you get a finished, publish-ready package:
    1. a branded black-and-gold header graphic (SVG + PNG) in assets/news/
    2. a full article page in news/<slug>.html, in the site's exact design
    3. the article added to the news index (news.html)
    4. the latest article featured in the homepage "Trust News" section
    5. social sharing, automatically: every article page, the news index,
       and every article card carries a share row (Facebook, X, LinkedIn,
       copy-link, and the phone's native Share sheet when available), and
       every page carries Open Graph / Twitter preview meta so a shared
       link shows the page's image. The index gets its own 1200x630 share
       graphic at assets/news/trust-news-share.png (SVG source alongside).

HOW TO USE:
  1. Copy tools/articles/plr-202641001.json to tools/articles/<new-slug>.json
  2. Fill in: slug, date, kicker, headline, dek (one-line summary),
     source_citation, sources[], graphic{} (headline_lines, from/to labels,
     alt — the hero image's alt text, always set it per article; to_suffix —
     optional text appended to each to-label, e.g. the PLR's " — EQUAL THIRD"),
     sections[] (heading + paragraphs + optional bullets; light HTML such as
     <b> is allowed inside paragraphs/bullets — everything is authored here,
     never scraped, so the facts on the page are exactly what you typed).
  3. Run:  python3 tools/generate_article.py
  4. Commit and push — Vercel deploys the repo automatically.

Facts discipline: the generator prints ONLY what the JSON says. Verify the
ruling/news text first (IRS source or reputable coverage quoting it), and
always keep the PLR caution section — a private letter ruling binds only
the taxpayer who requested it (IRC 6110(k)(3)).
"""
import html
import json
import pathlib
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTICLES_DIR = ROOT / "tools" / "articles"
NEWS_DIR = ROOT / "news"
ASSETS_NEWS = ROOT / "assets" / "news"
SITE = "https://trust.privatemoneyrightsplaybook.xyz"

GOLD = "#c9a227"
GOLD2 = "#e8cc6a"
GOLD_DEEP = "#8a6d1c"

DISCLAIMER = (
    '<b style="color:var(--gold2)">DISCLAIMER:</b> This article is educational '
    "material from Build A Trust 24, a Gold Series product. If you do not have "
    "the knowledge of a lawyer, consult a lawyer before implementing your trust. "
    "Nothing here is legal, tax, or financial advice, and reading it does not "
    "create an attorney-client relationship."
)

GA = """    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZY3QEL6P1S"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-ZY3QEL6P1S');
    </script>"""

ADSENSE = """    <!-- Google AdSense (pub-4295784512862093) — loader only; no ad units until Google approves the site -->
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4295784512862093" crossorigin="anonymous"></script>"""

FONTS = """    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;0,900;1,500&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />"""


def esc(s):
    return html.escape(str(s), quote=True)


def load_css():
    return (ROOT / "tools" / "news.css").read_text(encoding="utf-8")


def signup_block(source):
    return """
        <div class="nl-box">
          <h3>Get Trust News in Your Inbox</h3>
          <p>New rulings, trust law changes, and plain-language breakdowns from Build A Trust 24 — the same research that powers the builder. Free to read, free to receive.</p>
          <form class="newsletter-form" data-source="__SOURCE__">
            <input type="text" name="nlName" placeholder="Your name" aria-label="Your name" required />
            <input type="email" name="nlEmail" placeholder="Your email" aria-label="Your email" required />
            <button class="btn primary" type="submit">Join the Newsletter</button>
          </form>
          <p class="newsletter-done" style="display:none"></p>
        </div>""".replace("__SOURCE__", esc(source))


def footer_block(prefix):
    return """
    <footer>
      <div class="wrap">
        <p style="font-family:var(--serif);color:var(--gold2);font-size:1rem;margin:0 0 6px">Trust News &amp; Insights — by Build A Trust 24, a Gold Series product.</p>
        <p><a href="__P__index.html">Build A Trust 24 — The Golden Age of Million Dollar Trust Funds</a> &middot; <a href="__P__news.html">All Trust News articles</a></p>
        <p>Written by human, assisted by AI.</p>
      </div>
    </footer>""".replace("__P__", prefix)


def scripts_block(prefix):
    return """
    <script src="https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js"></script>
    <script src="__P__trust-config.js"></script>
    <script src="__P__newsletter.js"></script>
    <script src="__P__share.js"></script>""".replace("__P__", prefix)


def share_row(url, title, center=False, page_share=False):
    """Black-and-gold share row: Facebook / X / LinkedIn intent links
    (URL-encoded), a copy-link button, and a native Share button that
    share.js reveals only when navigator.share exists. No widgets."""
    eu = urllib.parse.quote(url, safe="")
    et = urllib.parse.quote(title, safe="")
    cls = "share-row" + (" center" if center else "") + (" page-share" if page_share else "")
    return (
        '<div class="' + cls + '" aria-label="Share this page">'
        '<span class="share-k">Share</span>'
        '<a class="share-btn" href="https://www.facebook.com/sharer/sharer.php?u=' + eu + '" target="_blank" rel="noopener">Facebook</a>'
        '<a class="share-btn" href="https://twitter.com/intent/tweet?url=' + eu + "&text=" + et + '" target="_blank" rel="noopener">X</a>'
        '<a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=' + eu + '" target="_blank" rel="noopener">LinkedIn</a>'
        '<button type="button" class="share-btn" data-copy-link="' + esc(url) + '">Copy link</button>'
        '<button type="button" class="share-btn" data-share-native data-share-url="' + esc(url) + '" data-share-title="' + esc(title) + '" hidden>Share &#8599;</button>'
        "</div>"
    )


# ---------------------------------------------------------------- graphics
def render_svg(spec):
    g = spec["graphic"]
    headline_svg = ""
    y = 118
    for ln in g["headline_lines"]:
        headline_svg += (
            '<text x="600" y="' + str(y) + '" text-anchor="middle" font-family="Playfair Display, Georgia, serif" '
            'font-weight="900" font-size="72" fill="' + GOLD2 + '">' + esc(ln) + "</text>\n      "
        )
        y += 82
    boxes = ""
    arrows = ""
    ys = [300, 388, 476]
    for i, label in enumerate(g["to_labels"]):
        yy = ys[i]
        boxes += (
            '<rect x="580" y="' + str(yy - 34) + '" width="520" height="68" rx="10" fill="#17130a" stroke="' + GOLD + '" stroke-width="2"/>'
            '<text x="840" y="' + str(yy + 9) + '" text-anchor="middle" font-family="Public Sans, sans-serif" font-weight="700" '
            'font-size="27" letter-spacing="2" fill="#f4ecd7">' + esc(label) + esc(g.get("to_suffix", "")) + "</text>\n      "
        )
        arrows += (
            '<line x1="452" y1="388" x2="566" y2="' + str(yy) + '" stroke="' + GOLD + '" stroke-width="3"/>'
            '<polygon points="566,' + str(yy) + " 550," + str(yy - 7) + " 550," + str(yy + 7) + '" fill="' + GOLD + '"/>\n      '
        )
    return """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="50%" cy="0%" r="90%">
      <stop offset="0%" stop-color="#241b08"/>
      <stop offset="55%" stop-color="#0a0805"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="18" y="18" width="1164" height="594" fill="none" stroke="GOLDDEEP" stroke-width="2"/>
  <rect x="28" y="28" width="1144" height="574" fill="none" stroke="#3a2f16" stroke-width="1"/>
  <text x="600" y="66" text-anchor="middle" font-family="Public Sans, sans-serif" font-weight="700" font-size="21" letter-spacing="8" fill="GOLD">TRUST NEWS &amp; INSIGHTS</text>
  HEADLINE
  <rect x="100" y="320" width="330" height="136" rx="12" fill="#1e190e" stroke="GOLD" stroke-width="2"/>
  <text x="265" y="376" text-anchor="middle" font-family="Public Sans, sans-serif" font-weight="700" font-size="24" fill="#f4ecd7">FROMLABEL</text>
  <text x="265" y="408" text-anchor="middle" font-family="Public Sans, sans-serif" font-size="19" fill="#c4b890">FROMSUB</text>
  <text x="265" y="436" text-anchor="middle" font-family="Public Sans, sans-serif" font-size="17" fill="#9a8c66">TOSUB</text>
  ARROWS
  BOXES
  <text x="600" y="556" text-anchor="middle" font-family="Public Sans, sans-serif" font-size="16" letter-spacing="2" fill="#9a8c66">FOOTER</text>
  <text x="600" y="584" text-anchor="middle" font-family="Public Sans, sans-serif" font-weight="700" font-size="22" fill="GOLD2">SUBLINE</text>
</svg>
""".replace("GOLDDEEP", GOLD_DEEP).replace("GOLD2", GOLD2).replace("GOLD", GOLD) \
     .replace("HEADLINE", headline_svg).replace("ARROWS", arrows).replace("BOXES", boxes) \
     .replace("FROMLABEL", esc(g["from_label"])).replace("FROMSUB", esc(g["from_sub"])) \
     .replace("TOSUB", esc(g.get("to_sub", ""))).replace("FOOTER", esc(g["footer"])) \
     .replace("SUBLINE", esc(g["subline"]))


def render_png(spec, out_path):
    """Render the same header graphic as a PNG (social/OG + card thumbnails)."""
    from PIL import Image, ImageDraw, ImageFont

    SERIF_B = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
    SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

    def font(path, size):
        return ImageFont.truetype(path, size)

    def centered(d, y, text, fnt, fill):
        w = d.textlength(text, font=fnt)
        d.text(((1200 - w) / 2, y), text, font=fnt, fill=fill)

    g = spec["graphic"]
    img = Image.new("RGB", (1200, 630), (10, 8, 5))
    d = ImageDraw.Draw(img)
    for i in range(160):
        a = int(26 * (1 - i / 160))
        d.line([(0, i), (1200, i)], fill=(10 + a, 8 + int(a * 0.8), 5))
    d.rectangle([18, 18, 1181, 611], outline=(138, 109, 28), width=2)
    d.rectangle([28, 28, 1171, 601], outline=(58, 47, 22), width=1)
    centered(d, 44, "T R U S T   N E W S   &   I N S I G H T S", font(SANS_B, 20), (201, 162, 39))
    y = 84
    for ln in g["headline_lines"]:
        centered(d, y, ln, font(SERIF_B, 66), (232, 204, 106))
        y += 78
    d.rounded_rectangle([100, 320, 430, 456], radius=12, fill=(30, 25, 14), outline=(201, 162, 39), width=2)
    label = g["from_label"]
    words, lines, cur = label.split(), [], ""
    for w_ in words:
        trial = (cur + " " + w_).strip()
        if d.textlength(trial, font=font(SANS_B, 23)) > 300 and cur:
            lines.append(cur)
            cur = w_
        else:
            cur = trial
    if cur:
        lines.append(cur)
    ly = 340
    for ln in lines[:2]:
        d.text((265 - d.textlength(ln, font=font(SANS_B, 23)) / 2, ly), ln, font=font(SANS_B, 23), fill=(244, 236, 215))
        ly += 32
    sub = g["from_sub"]
    d.text((265 - d.textlength(sub, font=font(SANS, 18)) / 2, ly + 2), sub, font=font(SANS, 18), fill=(196, 184, 144))
    tos = g.get("to_sub", "")
    d.text((265 - d.textlength(tos, font=font(SANS, 16)) / 2, ly + 30), tos, font=font(SANS, 16), fill=(154, 140, 102))
    ys = [300, 388, 476]
    for i, lab in enumerate(g["to_labels"]):
        yy = ys[i]
        d.line([(452, 388), (562, yy)], fill=(201, 162, 39), width=3)
        d.polygon([(566, yy), (548, yy - 7), (548, yy + 7)], fill=(201, 162, 39))
        d.rounded_rectangle([580, yy - 34, 1100, yy + 34], radius=10, fill=(23, 19, 10), outline=(201, 162, 39), width=2)
        t = lab + g.get("to_suffix", "")
        d.text((840 - d.textlength(t, font=font(SANS_B, 25)) / 2, yy - 16), t, font=font(SANS_B, 25), fill=(244, 236, 215))
    centered(d, 524, g["footer"], font(SANS, 16), (154, 140, 102))
    centered(d, 550, g["subline"], font(SANS_B, 22), (232, 204, 106))
    img.save(out_path, "PNG")


# ------------------------------------------------- index share graphic
INDEX_SHARE_TITLE = "TRUST NEWS & INSIGHTS"
INDEX_SHARE_SUB = "Rulings & Trust Law, In Plain Language"
INDEX_SHARE_CHIPS = ["IRS PRIVATE LETTER RULINGS", "TRUST LAW DEVELOPMENTS", "PLAIN-LANGUAGE BREAKDOWNS"]
INDEX_SHARE_FOOTER = "TRUST.PRIVATEMONEYRIGHTSPLAYBOOK.XYZ/NEWS"


def render_index_share_svg():
    chips = ""
    for i, label in enumerate(INDEX_SHARE_CHIPS):
        x = 110 + i * 340
        chips += (
            '<rect x="' + str(x) + '" y="452" width="300" height="56" rx="10" fill="#17130a" stroke="' + GOLD + '" stroke-width="2"/>'
            '<text x="' + str(x + 150) + '" y="487" text-anchor="middle" font-family="Public Sans, sans-serif" font-weight="700" '
            'font-size="17" letter-spacing="1" fill="#f4ecd7">' + esc(label) + "</text>\n  "
        )
    return """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="50%" cy="0%" r="90%">
      <stop offset="0%" stop-color="#241b08"/>
      <stop offset="55%" stop-color="#0a0805"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="18" y="18" width="1164" height="594" fill="none" stroke="GOLDDEEP" stroke-width="2"/>
  <rect x="28" y="28" width="1144" height="574" fill="none" stroke="#3a2f16" stroke-width="1"/>
  <text x="600" y="76" text-anchor="middle" font-family="Public Sans, sans-serif" font-weight="700" font-size="21" letter-spacing="8" fill="GOLD">BUILD A TRUST 24</text>
  <text x="600" y="212" text-anchor="middle" font-family="Playfair Display, Georgia, serif" font-weight="900" font-size="92" fill="GOLD2">TRUST NEWS</text>
  <text x="600" y="312" text-anchor="middle" font-family="Playfair Display, Georgia, serif" font-weight="900" font-size="92" fill="GOLD2">&amp; INSIGHTS</text>
  <line x1="430" y1="356" x2="770" y2="356" stroke="GOLD" stroke-width="2"/>
  <text x="600" y="410" text-anchor="middle" font-family="Public Sans, sans-serif" font-weight="700" font-size="25" letter-spacing="3" fill="#f4ecd7">RULINGS &amp; TRUST LAW, IN PLAIN LANGUAGE</text>
  CHIPS
  <text x="600" y="572" text-anchor="middle" font-family="Public Sans, sans-serif" font-size="16" letter-spacing="2" fill="#9a8c66">FOOTER</text>
</svg>
""".replace("GOLDDEEP", GOLD_DEEP).replace("GOLD2", GOLD2).replace("GOLD", GOLD) \
     .replace("CHIPS", chips).replace("FOOTER", esc(INDEX_SHARE_FOOTER))


def render_index_share_png(out_path):
    """Same index share graphic as a 1200x630 PNG (the og:image)."""
    from PIL import Image, ImageDraw, ImageFont

    SERIF_B = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
    SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

    def font(path, size):
        return ImageFont.truetype(path, size)

    def centered(d, y, text, fnt, fill):
        w = d.textlength(text, font=fnt)
        d.text(((1200 - w) / 2, y), text, font=fnt, fill=fill)

    img = Image.new("RGB", (1200, 630), (10, 8, 5))
    d = ImageDraw.Draw(img)
    for i in range(160):
        a = int(26 * (1 - i / 160))
        d.line([(0, i), (1200, i)], fill=(10 + a, 8 + int(a * 0.8), 5))
    d.rectangle([18, 18, 1181, 611], outline=(138, 109, 28), width=2)
    d.rectangle([28, 28, 1171, 601], outline=(58, 47, 22), width=1)
    centered(d, 52, "B U I L D   A   T R U S T   2 4", font(SANS_B, 20), (201, 162, 39))
    centered(d, 118, "TRUST NEWS", font(SERIF_B, 88), (232, 204, 106))
    centered(d, 218, "& INSIGHTS", font(SERIF_B, 88), (232, 204, 106))
    d.line([(430, 356), (770, 356)], fill=(201, 162, 39), width=2)
    centered(d, 384, "RULINGS & TRUST LAW, IN PLAIN LANGUAGE", font(SANS_B, 23), (244, 236, 215))
    for i, label in enumerate(INDEX_SHARE_CHIPS):
        x = 110 + i * 340
        d.rounded_rectangle([x, 452, x + 300, 508], radius=10, fill=(23, 19, 10), outline=(201, 162, 39), width=2)
        d.text((x + 150 - d.textlength(label, font=font(SANS_B, 14)) / 2, 473), label, font=font(SANS_B, 14), fill=(244, 236, 215))
    centered(d, 556, INDEX_SHARE_FOOTER, font(SANS, 16), (154, 140, 102))
    img.save(out_path, "PNG")


# ---------------------------------------------------------------- pages
def hero_alt(spec):
    """Hero image alt text. Comes from the article JSON (graphic.alt) so a
    non-PLR article never inherits the PLR split diagram's description;
    falls back to a generic headline-based alt when the JSON sets none."""
    alt = (spec.get("graphic") or {}).get("alt")
    if alt:
        return alt
    return spec["headline"] + " — header graphic from Trust News & Insights"


def render_article(spec):
    css = load_css()
    sections_html = ""
    for sec in spec["sections"]:
        inner = "<h2>" + esc(sec["heading"]) + "</h2>"
        for p in sec.get("paragraphs", []):
            inner += "<p>" + p + "</p>"
        if sec.get("bullets"):
            inner += "<ul>" + "".join("<li>" + b + "</li>" for b in sec["bullets"]) + "</ul>"
        if "read this before" in sec["heading"].lower():
            sections_html += '<div class="caution">' + inner + "</div>"
        else:
            sections_html += inner
    sources_html = "".join("<li>" + esc(s) + "</li>" for s in spec.get("sources", []))
    page = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="data:," />
    <meta name="description" content="DEK" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="HEADLINE" />
    <meta property="og:description" content="DEK" />
    <meta property="og:image" content="SITEURL/assets/news/SLUG-header.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:url" content="SITEURL/news/SLUG.html" />
    <meta property="og:site_name" content="Build A Trust 24" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="HEADLINE" />
    <meta name="twitter:description" content="DEK" />
    <meta name="twitter:image" content="SITEURL/assets/news/SLUG-header.png" />
    <link rel="canonical" href="SITEURL/news/SLUG.html" />
    <title>HEADLINE | Trust News &amp; Insights — Build A Trust 24</title>
GA
ADSENSE
FONTS
    <style>CSS</style>
  </head>
  <body>
    <div class="wrap">
      <div class="topbar">
        <a class="brand" href="../index.html">Build A Trust 24</a>
        <span><a href="../news.html">Trust News &amp; Insights</a> &middot; <a href="../index.html#builder">Build My Trust</a> &middot; <a href="../index.html#signup">Sign Up Free</a></span>
      </div>
      <div class="art-head">
        <span class="series-tag">Trust News &amp; Insights</span>
        <h1>HEADLINE</h1>
        <p class="art-dek">DEK</p>
        <p class="art-meta">DATEDISPLAY &middot; Source: SOURCECIT</p>
        SHAREROW
      </div>
      <div class="art-hero"><img src="../assets/news/SLUG-header.png" alt="HEROALT" /></div>
      <div class="art-body">
SECTIONS
        <div class="disclaimer">DISCLAIMER</div>
SIGNUP
      </div>
      <div class="sources"><p style="margin-bottom:4px"><b>Sources</b></p><ul style="margin-top:0;padding-left:18px">SOURCES</ul></div>
      <p class="more-news"><a href="../news.html">&larr; More Trust News &amp; Insights</a></p>
    </div>
FOOTER
SCRIPTS
  </body>
</html>
"""
    return (
        page.replace("HEADLINE", esc(spec["headline"]))
        .replace("HEROALT", esc(hero_alt(spec)))
        .replace("DEK", esc(spec["dek"]))
        .replace("SITEURL", SITE)
        .replace("SLUG", spec["slug"])
        .replace("DATEDISPLAY", esc(spec["date_display"]))
        .replace("SOURCECIT", esc(spec["source_citation"]))
        .replace("SHAREROW", share_row(SITE + "/news/" + spec["slug"] + ".html", spec["headline"], center=True))
        .replace("SECTIONS", sections_html)
        .replace("DISCLAIMER", DISCLAIMER)
        .replace("SOURCES", sources_html)
        .replace("SIGNUP", signup_block("newsletter-article-" + spec["slug"]))
        .replace("FOOTER", footer_block("../"))
        .replace("SCRIPTS", scripts_block("../"))
        .replace("GA", GA)
        .replace("ADSENSE", ADSENSE)
        .replace("FONTS", FONTS)
        .replace("CSS", css)
    )


def card_html(spec, prefix, lazy=True):
    lazy_attr = ' loading="lazy"' if lazy else ""
    return (
        '<div class="article-card">'
        '<a class="card-link" href="' + prefix + "news/" + spec["slug"] + '.html">'
        '<img src="' + prefix + "assets/news/" + spec["slug"] + '-header.png" alt=""' + lazy_attr + ' />'
        '<span class="k">' + esc(spec["kicker"]) + "</span>"
        "<h3>" + esc(spec["headline"]) + "</h3>"
        "<p>" + esc(spec["dek"]) + "</p>"
        '<p class="meta">' + esc(spec["date_display"]) + " &middot; " + esc(spec["source_citation"]) + "</p></a>"
        + share_row(SITE + "/news/" + spec["slug"] + ".html", spec["headline"])
        + "</div>"
    )


def render_index(specs):
    css = load_css()
    cards = "\n          ".join(card_html(s, "") for s in specs)
    page = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="data:," />
    <meta name="description" content="Trust News & Insights from Build A Trust 24: IRS rulings, trust law changes, and plain-language breakdowns for families building and administering trust funds — including how to divide a family trust and what a grandfathered GST trust can do." />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Build A Trust 24" />
    <meta property="og:title" content="Trust News &amp; Insights — Rulings &amp; Trust Law, In Plain Language" />
    <meta property="og:description" content="Trust News & Insights from Build A Trust 24: IRS rulings, trust law changes, and plain-language breakdowns for families building and administering trust funds — including how to divide a family trust and what a grandfathered GST trust can do." />
    <meta property="og:url" content="SITEURL/news.html" />
    <meta property="og:image" content="SITEURL/assets/news/trust-news-share.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="Trust News &amp; Insights — Rulings &amp; Trust Law, In Plain Language" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Trust News &amp; Insights — Rulings &amp; Trust Law, In Plain Language" />
    <meta name="twitter:description" content="Trust News & Insights from Build A Trust 24: IRS rulings, trust law changes, and plain-language breakdowns for families building and administering trust funds — including how to divide a family trust and what a grandfathered GST trust can do." />
    <meta name="twitter:image" content="SITEURL/assets/news/trust-news-share.png" />
    <link rel="canonical" href="SITEURL/news.html" />
    <title>Trust News &amp; Insights — IRS Rulings &amp; Trust Law, In Plain Language | Build A Trust 24</title>
GA
ADSENSE
FONTS
    <style>CSS</style>
  </head>
  <body>
    <div class="wrap">
      <div class="topbar">
        <a class="brand" href="index.html">Build A Trust 24</a>
        <span><a href="index.html#builder">Build My Trust</a> &middot; <a href="index.html#library">16 Trust Types</a> &middot; <a href="index.html#signup">Sign Up Free</a></span>
      </div>
      <section>
        <div class="sec-head"><h2>Trust News &amp; Insights</h2><div class="rule"></div></div>
        <p class="sec-sub">The newsletter desk of Build A Trust 24: IRS private letter rulings, trust law developments, and strategy breakdowns — read straight from the source documents and translated into plain language. Every article is free to read. When a ruling is involved, we say exactly what the IRS approved — and what it did not.</p>
        SHAREROW
        <div class="article-grid">
          CARDS
        </div>
SIGNUP
      </section>
    </div>
FOOTER
SCRIPTS
  </body>
</html>
"""
    return (
        page.replace("CARDS", cards)
        .replace("SHAREROW", share_row(SITE + "/news.html", "Trust News & Insights — Rulings & Trust Law, In Plain Language", page_share=True))
        .replace("SITEURL", SITE)
        .replace("SIGNUP", signup_block("newsletter-index"))
        .replace("FOOTER", footer_block(""))
        .replace("SCRIPTS", scripts_block(""))
        .replace("GA", GA)
        .replace("ADSENSE", ADSENSE)
        .replace("FONTS", FONTS)
        .replace("CSS", css)
    )


HOME_START = "<!-- NEWS-SECTION-START (generated by tools/generate_article.py — do not hand-edit) -->"
HOME_END = "<!-- NEWS-SECTION-END -->"


def update_homepage(specs):
    index_path = ROOT / "index.html"
    src = index_path.read_text(encoding="utf-8")
    latest = specs[0]
    block = (
        HOME_START
        + """
      <section id="news">
        <div class="sec-head"><h2>Trust News &amp; Insights — Rulings &amp; Trust Law, In Plain Language</h2><div class="rule"></div></div>
        <p class="sec-sub">From the Build A Trust 24 newsletter desk: IRS rulings and trust law developments, read from the source and explained plainly — free to read, no account needed. The latest:</p>
        <div class="article-grid">
          """
        + "\n          ".join(card_html(s, "", lazy=False) for s in specs[:2])
        + """
        </div>
        <div class="nl-box" style="margin-left:0">
          <h3>Get Trust News in Your Inbox</h3>
          <p>New rulings, trust law changes, and plain-language breakdowns from Build A Trust 24. Free to read, free to receive.</p>
          <form class="newsletter-form" data-source="newsletter-home">
            <input type="text" name="nlName" placeholder="Your name" aria-label="Your name" required />
            <input type="email" name="nlEmail" placeholder="Your email" aria-label="Your email" required />
            <button class="btn primary" type="submit">Join the Newsletter</button>
          </form>
          <p class="newsletter-done" style="display:none"></p>
          <p style="margin-top:14px"><a href="news.html">Read all Trust News &amp; Insights articles &rarr;</a></p>
        </div>
      </section>
      """
        + HOME_END
    )
    if HOME_START in src and HOME_END in src:
        a = src.index(HOME_START)
        b = src.index(HOME_END) + len(HOME_END)
        src = src[:a] + block + src[b:]
    else:
        anchor = "    </main>"
        assert anchor in src, "homepage </main> anchor not found"
        src = src.replace(anchor, block + "\n" + anchor, 1)
    # nav link in the hero CTAs (idempotent)
    if 'href="news.html"' not in src.split("</header>")[0]:
        hero_anchor = 'StartBusiness24 &mdash; Start Your Company</a>'
        assert hero_anchor in src, "hero CTA anchor not found"
        src = src.replace(
            hero_anchor,
            hero_anchor + '\n          <a class="btn ghost" href="news.html" style="text-decoration:none;display:inline-block">Trust News &amp; Insights</a>',
            1,
        )
    # newsletter.js include (idempotent)
    if 'src="newsletter.js"' not in src:
        tag = '<script src="trust-app.js"></script>'
        assert tag in src, "trust-app.js script tag not found"
        src = src.replace(tag, tag + '\n    <script src="newsletter.js"></script>', 1)
    # share.js include for the news card's share row (idempotent)
    if 'src="share.js"' not in src:
        tag = '<script src="newsletter.js"></script>'
        assert tag in src, "newsletter.js script tag not found"
        src = src.replace(tag, tag + '\n    <script src="share.js"></script>', 1)
    # share-row styles for the homepage news card (idempotent)
    if ".share-row{" not in src:
        style_anchor = "    </style>\n\n    <div class=\"sb24-bar\">"
        assert style_anchor in src, "homepage style anchor not found (share css)"
        share_css = """      .article-card .card-link{display:block;color:inherit;text-decoration:none}
      .share-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}
      .share-k{font-size:.7rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--faint)}
      .share-btn{appearance:none;border:1px solid var(--gold-deep);background:rgba(201,162,39,.06);color:var(--gold2);font:600 .8rem var(--sans);padding:7px 13px;border-radius:999px;cursor:pointer;text-decoration:none;display:inline-block;line-height:1.25}
      .share-btn:hover{border-color:var(--gold)}
"""
        src = src.replace(style_anchor, share_css + style_anchor, 1)
    # scoped styles for the homepage news block (idempotent)
    if ".nl-box{" not in src:
        style_anchor = "    </style>\n\n    <div class=\"sb24-bar\">"
        assert style_anchor in src, "homepage style anchor not found"
        nl_css = """      .nl-box{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--gold-deep);border-radius:16px;padding:24px;max-width:820px;margin:30px auto 0}
      .nl-box h3{font-family:var(--serif);margin:0 0 6px;font-size:1.3rem;color:var(--ink)}
      .nl-box p{color:var(--muted);margin:0 0 14px;font-size:.95rem}
      .newsletter-form{display:flex;flex-direction:column;gap:9px;max-width:440px}
      .newsletter-form input{background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:11px 14px;font:400 .95rem var(--sans)}
      .newsletter-done{color:var(--good);font-size:.92rem;margin-top:10px}
"""
        src = src.replace(style_anchor, nl_css + style_anchor, 1)
    index_path.write_text(src, encoding="utf-8")


def main():
    specs = []
    for p in sorted(ARTICLES_DIR.glob("*.json")):
        specs.append(json.loads(p.read_text(encoding="utf-8")))
    # Newest first. An optional "seq" in a spec breaks same-date ties
    # (higher = newer) so a batch of same-day articles keeps its
    # intended running order instead of falling back to filename order.
    specs.sort(key=lambda s: (s["date"], s.get("seq", 0)), reverse=True)
    assert specs, "no article specs found"
    NEWS_DIR.mkdir(exist_ok=True)
    ASSETS_NEWS.mkdir(parents=True, exist_ok=True)
    for spec in specs:
        slug = spec["slug"]
        (ASSETS_NEWS / (slug + "-header.svg")).write_text(render_svg(spec), encoding="utf-8")
        render_png(spec, ASSETS_NEWS / (slug + "-header.png"))
        (NEWS_DIR / (slug + ".html")).write_text(render_article(spec), encoding="utf-8")
        print("article:", slug)
    (ASSETS_NEWS / "trust-news-share.svg").write_text(render_index_share_svg(), encoding="utf-8")
    render_index_share_png(ASSETS_NEWS / "trust-news-share.png")
    print("index share graphic: assets/news/trust-news-share.png (1200x630)")
    (ROOT / "news.html").write_text(render_index(specs), encoding="utf-8")
    print("index: news.html with", len(specs), "article(s)")
    update_homepage(specs)
    print("homepage: news section updated, latest =", specs[0]["slug"])


if __name__ == "__main__":
    main()
