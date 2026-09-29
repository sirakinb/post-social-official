from pathlib import Path
from shutil import copyfile
from textwrap import wrap

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "submission" / "Post-Social-TikTok-UX-Mockup.pdf"
PUBLIC_OUTPUT = ROOT / "public" / "submission" / "Post-Social-TikTok-UX-Mockup.pdf"
ICON = ROOT / "public" / "post-social-icon-1024.png"

W, H = landscape(letter)
BG = HexColor("#0C081A")
SURFACE = HexColor("#1B1531")
RAISED = HexColor("#251D43")
BORDER = HexColor("#55427F")
PLUM = HexColor("#9B6CFF")
PLUM_DARK = HexColor("#3A285D")
TEXT = HexColor("#F8F6FF")
MUTED = HexColor("#AAA3BB")
SUBTLE = HexColor("#756E89")
GREEN = HexColor("#38E77A")
YELLOW = HexColor("#FFD65A")
WARNING = HexColor("#FFB45B")


def round_rect(c, x, y, width, height, radius=12, fill=SURFACE, stroke=BORDER, line=1):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(line)
    c.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def text(c, value, x, y, size=12, color=TEXT, font="Helvetica", max_width=None, leading=None):
    c.setFont(font, size)
    c.setFillColor(color)
    if not max_width:
        c.drawString(x, y, value)
        return y
    chars = max(12, int(max_width / (size * 0.55)))
    line_height = leading or size * 1.35
    current_y = y
    for line_text in wrap(value, chars):
        c.drawString(x, current_y, line_text)
        current_y -= line_height
    return current_y


def label(c, value, x, y, color=PLUM):
    text(c, value.upper(), x, y, 7.5, color, "Courier-Bold")


def header(c, step, title, subtitle):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setStrokeColor(HexColor("#9B6CFF"))
    c.setFillColor(HexColor("#9B6CFF"))
    c.setFillAlpha(0.08)
    for gx in range(0, int(W), 36):
        c.line(gx, 0, gx, H)
    for gy in range(0, int(H), 36):
        c.line(0, gy, W, gy)
    c.setFillAlpha(1)
    label(c, f"Post Social / TikTok Direct Post / {step}", 42, H - 43)
    text(c, title, 42, H - 78, 25, TEXT, "Helvetica-Bold")
    text(c, subtitle, 42, H - 101, 10.5, MUTED, max_width=690)
    c.setStrokeColor(BORDER)
    c.line(42, H - 120, W - 42, H - 120)


def callout(c, number, title, body, x, y, width=230, color=PLUM):
    round_rect(c, x, y, width, 88, 12, PLUM_DARK, color, 1.2)
    c.setFillColor(color)
    c.circle(x + 22, y + 64, 11, fill=1, stroke=0)
    text(c, str(number), x + 18.5, y + 60.5, 9, BG, "Helvetica-Bold")
    text(c, title, x + 40, y + 61, 10, TEXT, "Helvetica-Bold")
    text(c, body, x + 16, y + 42, 8.5, MUTED, max_width=width - 32, leading=11)


def status_pill(c, value, x, y, color=GREEN, width=82):
    round_rect(c, x, y, width, 22, 7, HexColor("#153A2A") if color == GREEN else PLUM_DARK, color, 0.8)
    text(c, value, x + 12, y + 7, 7.5, color, "Courier-Bold")


def screen_frame(c, x=42, y=42, width=470, height=330, title="Post Social"):
    round_rect(c, x, y, width, height, 16, HexColor("#100B22"), BORDER, 1.2)
    c.setFillColor(HexColor("#080610"))
    c.roundRect(x, y + height - 45, width, 45, 16, fill=1, stroke=0)
    c.rect(x, y + height - 45, width, 22, fill=1, stroke=0)
    c.setFillColor(PLUM)
    c.circle(x + 22, y + height - 22, 4, fill=1, stroke=0)
    text(c, title, x + 34, y + height - 27, 12, TEXT, "Helvetica-Bold")
    return x, y, width, height


def page_cover(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.drawImage(ImageReader(str(ICON)), 54, H - 164, 92, 92, mask="auto")
    label(c, "TikTok Content Posting API audit", 54, H - 195)
    text(c, "Post Social", 54, H - 245, 38, TEXT, "Helvetica-Bold")
    text(c, "Direct Post UX mockup", 54, H - 278, 24, PLUM, "Helvetica-Bold")
    text(c, "Post Social lets creators and businesses schedule and publish original content across social networks from one place.", 54, H - 318, 12, MUTED, max_width=500, leading=17)
    round_rect(c, 545, 74, 190, 370, 24, SURFACE, BORDER, 1.2)
    text(c, "REVIEW FLOW", 572, 409, 8, PLUM, "Courier-Bold")
    steps = [
        ("01", "Connect", "Genuine TikTok OAuth"),
        ("02", "Compose", "Creator-aware settings"),
        ("03", "Approve", "Explicit human consent"),
        ("04", "Publish", "Upload + status polling"),
        ("05", "Confirm", "Platform result + live link"),
    ]
    sy = 360
    for n, heading, detail in steps:
        c.setFillColor(PLUM)
        c.circle(574, sy + 4, 12, fill=1, stroke=0)
        text(c, n, 566, sy + 1, 7.5, BG, "Helvetica-Bold")
        text(c, heading, 596, sy + 4, 11, TEXT, "Helvetica-Bold")
        text(c, detail, 596, sy - 11, 8.5, MUTED)
        sy -= 61
    label(c, "Prepared July 21, 2026 · Pentridge Media", 54, 45, SUBTLE)
    c.showPage()


def page_connect(c):
    header(c, "01", "Connect the creator’s TikTok account", "Post Social uses OAuth only. The creator sees TikTok’s genuine consent screen and returns with their identity visible.")
    sx, sy, sw, sh = screen_frame(c, 42, 45, 470, 330, "Post Social · Connections")
    label(c, "Accounts", sx + 22, sy + sh - 76)
    text(c, "Your publishing connections", sx + 22, sy + sh - 104, 18, TEXT, "Helvetica-Bold")
    round_rect(c, sx + 22, sy + 122, sw - 44, 92, 12, RAISED, BORDER)
    c.setFillColor(PLUM)
    c.circle(sx + 50, sy + 168, 18, fill=1, stroke=0)
    text(c, "TT", sx + 40, sy + 163, 10, white, "Helvetica-Bold")
    text(c, "Aki Creates", sx + 80, sy + 177, 13, TEXT, "Helvetica-Bold")
    text(c, "@akicreates · TikTok", sx + 80, sy + 157, 9, MUTED)
    status_pill(c, "CONNECTED", sx + 320, sy + 157, GREEN, 90)
    round_rect(c, sx + 22, sy + 66, 150, 34, 9, PLUM, PLUM)
    text(c, "+ Connect TikTok", sx + 42, sy + 78, 10, white, "Helvetica-Bold")
    callout(c, 1, "user.info.basic", "Used after consent to show the creator nickname and confirm which account receives the post.", 540, 264)
    callout(c, 2, "No password access", "TikTok returns scoped OAuth tokens. Post Social encrypts them server-side and never exposes them to the browser.", 540, 152, color=GREEN)
    callout(c, 3, "Cancellation is safe", "If the creator cancels OAuth, no account or credential is stored and the app explains what happened.", 540, 40, color=WARNING)
    c.showPage()


def page_compose(c):
    header(c, "02", "Prepare original creator-selected content", "The creator chooses media, copy, destination, and timing. Preset text stays editable before anything is transmitted.")
    sx, sy, sw, sh = screen_frame(c, 42, 45, 470, 330, "Post Social · Create")
    text(c, "Make something worth sharing.", sx + 22, sy + sh - 84, 17, TEXT, "Helvetica-Bold")
    round_rect(c, sx + 22, sy + 145, 180, 104, 10, RAISED, BORDER)
    label(c, "Media", sx + 38, sy + 228, SUBTLE)
    text(c, "Drop an MP4 or choose a file", sx + 38, sy + 196, 10, TEXT, "Helvetica-Bold")
    text(c, "Validated against creator limits", sx + 38, sy + 177, 8.5, MUTED)
    round_rect(c, sx + 220, sy + 145, 228, 104, 10, RAISED, BORDER)
    label(c, "Caption", sx + 236, sy + 228, SUBTLE)
    text(c, "Behind the scenes from this week’s shoot.", sx + 236, sy + 202, 9.5, TEXT, max_width=194)
    text(c, "Editable · 47 / 2,200", sx + 236, sy + 165, 8, MUTED)
    round_rect(c, sx + 22, sy + 72, 426, 54, 10, PLUM_DARK, PLUM)
    text(c, "TT", sx + 40, sy + 93, 9, PLUM, "Helvetica-Bold")
    text(c, "Aki Creates · selected destination", sx + 72, sy + 93, 10, TEXT, "Helvetica-Bold")
    callout(c, 1, "Creator-selected media", "Post Social is an original-content workspace—not an automatic scraper or blind reposting tool.", 540, 264)
    callout(c, 2, "File validation", "MP4/H.264, up to 1 GB, with duration checked against max_video_post_duration_sec.", 540, 152, color=GREEN)
    callout(c, 3, "Nothing sent yet", "Choosing a file and drafting copy do not call video.publish. Transmission waits for explicit approval.", 540, 40, color=YELLOW)
    c.showPage()


def page_settings(c):
    header(c, "03", "Honor every creator-specific posting option", "Post Social queries creator_info when the composer opens and renders only the privacy and interaction choices TikTok returns.")
    sx, sy, sw, sh = screen_frame(c, 42, 45, 470, 330, "Post Social · TikTok settings")
    round_rect(c, sx + 20, sy + 244, 430, 50, 10, RAISED, BORDER)
    text(c, "Aki Creates", sx + 36, sy + 273, 11, TEXT, "Helvetica-Bold")
    text(c, "Posting capacity available · max 10:00", sx + 36, sy + 257, 8.5, GREEN)
    label(c, "Who can view this post?", sx + 20, sy + 222, SUBTLE)
    round_rect(c, sx + 20, sy + 178, 260, 34, 8, BG, WARNING)
    text(c, "Choose privacy — no default", sx + 34, sy + 190, 9.5, MUTED)
    label(c, "Interactions · off by default", sx + 20, sy + 155, SUBTLE)
    for index, (name, available) in enumerate([("Comments", True), ("Duet", False), ("Stitch", True)]):
        x = sx + 20 + index * 142
        round_rect(c, x, sy + 116, 128, 30, 8, RAISED, BORDER)
        c.setFillColor(SUBTLE if not available else PLUM_DARK)
        c.circle(x + 17, sy + 131, 7, fill=1, stroke=0)
        text(c, name + (" unavailable" if not available else ""), x + 31, sy + 127, 7.5, MUTED if not available else TEXT)
    label(c, "Content disclosure · off", sx + 20, sy + 94, SUBTLE)
    text(c, "By posting, you agree to TikTok’s Music Usage Confirmation.", sx + 20, sy + 63, 8.5, MUTED)
    callout(c, 1, "No default privacy", "The creator must actively choose from privacy_level_options returned for this exact account.", 540, 264)
    callout(c, 2, "Availability respected", "Comment, Duet, and Stitch remain off; unavailable choices stay disabled with an explanation.", 540, 152, color=GREEN)
    callout(c, 3, "Disclosure controls", "Your Brand, Branded Content, and AI-generated indicators are carried into the Direct Post request.", 540, 40, color=YELLOW)
    c.showPage()


def page_approve(c):
    header(c, "04", "Require explicit human approval", "The Approval MVP uses Confirm Each. An upload or agent-created draft cannot publish until a person approves the final proof.")
    sx, sy, sw, sh = screen_frame(c, 42, 45, 470, 330, "Post Social · Final proof")
    label(c, "Waiting for approval", sx + 22, sy + sh - 78, WARNING)
    text(c, "Behind the scenes from this week’s shoot.", sx + 22, sy + sh - 108, 15, TEXT, "Helvetica-Bold", max_width=420)
    round_rect(c, sx + 22, sy + 142, 426, 82, 10, RAISED, BORDER)
    text(c, "TikTok · Aki Creates", sx + 38, sy + 198, 10, TEXT, "Helvetica-Bold")
    text(c, "Public · Comments off · Duet off · Stitch off", sx + 38, sy + 178, 8.5, MUTED)
    text(c, "Original content · Music confirmation shown", sx + 38, sy + 160, 8.5, MUTED)
    round_rect(c, sx + 22, sy + 78, 132, 38, 9, PLUM, PLUM)
    text(c, "Approve & publish", sx + 38, sy + 92, 10, white, "Helvetica-Bold")
    round_rect(c, sx + 166, sy + 78, 100, 38, 9, BG, BORDER)
    text(c, "Return", sx + 192, sy + 92, 10, MUTED, "Helvetica-Bold")
    callout(c, 1, "Active confirmation", "The approval button records the user, timestamp, destination, selected options, and consent moment.", 540, 264)
    callout(c, 2, "video.publish fires here", "Only after approval does Post Social initialize TikTok Direct Post and begin the chunked upload.", 540, 152, color=YELLOW)
    callout(c, 3, "Agent-safe policy", "API or MCP callers may draft, but Confirm Each still routes the final post to this human review card.", 540, 40, color=GREEN)
    c.showPage()


def page_result(c):
    header(c, "05", "Show the platform-confirmed result", "Post Social stores TikTok’s publish ID before polling, checks status without duplicate uploads, and shows a live link only after PUBLISH_COMPLETE.")
    sx, sy, sw, sh = screen_frame(c, 42, 45, 470, 330, "Post Social · Activity")
    label(c, "Latest", sx + 22, sy + sh - 78, SUBTLE)
    text(c, "Behind the scenes from this week’s shoot.", sx + 22, sy + sh - 108, 14, TEXT, "Helvetica-Bold", max_width=420)
    round_rect(c, sx + 22, sy + 157, 426, 72, 10, HexColor("#153A2A"), GREEN)
    c.setFillColor(GREEN)
    c.circle(sx + 50, sy + 193, 14, fill=1, stroke=0)
    text(c, "✓", sx + 45, sy + 188, 11, BG, "Helvetica-Bold")
    text(c, "TikTok confirmed this post is live", sx + 76, sy + 199, 11, TEXT, "Helvetica-Bold")
    text(c, "PUBLISH_COMPLETE · request ID retained", sx + 76, sy + 180, 8.5, GREEN)
    round_rect(c, sx + 22, sy + 96, 130, 34, 8, PLUM_DARK, PLUM)
    text(c, "Open live post ↗", sx + 40, sy + 108, 9, PLUM, "Helvetica-Bold")
    text(c, "If TikTok fails, this area shows a sanitized reason and a safe retry state instead.", sx + 22, sy + 68, 8.5, MUTED, max_width=420)
    callout(c, 1, "Status polling", "Post Social checks status/fetch within TikTok’s rate limit until complete, failed, or timed out.", 540, 264)
    callout(c, 2, "No false success", "The UI never marks a destination published from an upload response alone; TikTok must confirm it.", 540, 152, color=GREEN)
    callout(c, 3, "User-controlled access", "Disconnect removes the encrypted credential, cancels queued work, and prevents future publishing.", 540, 40, color=WARNING)
    c.showPage()


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("Post Social — TikTok Direct Post UX Mockup")
    c.setAuthor("Pentridge Media")
    c.setSubject("TikTok Content Posting API audit UX flow")
    page_cover(c)
    page_connect(c)
    page_compose(c)
    page_settings(c)
    page_approve(c)
    page_result(c)
    c.save()
    PUBLIC_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    copyfile(OUTPUT, PUBLIC_OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()
