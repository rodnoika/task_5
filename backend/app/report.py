from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import (
    Circle,
    Drawing,
    Line,
    Polygon,
    PolyLine,
    Rect,
    String,
)
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .data import PUBLIC_ROOT
from .models import AnalysisResponse, AnalyzedMine, Anomaly, ReportRequest

INK = colors.HexColor("#171b22")
MUTED = colors.HexColor("#687385")
PALE = colors.HexColor("#f5f7fa")
RULE = colors.HexColor("#dfe4eb")
SPIKE = colors.HexColor("#d63939")
DROP = colors.HexColor("#0ca6c7")
YELLOW = colors.HexColor("#ffdb00")
TREND = colors.HexColor("#667382")
PALETTE = [
    "#206bc4",
    "#2fb344",
    "#f76707",
    "#ae3ec9",
    "#0ca6c7",
    "#d63939",
    "#4263eb",
    "#f59f00",
    "#1098ad",
    "#e64980",
    "#74b816",
    "#6741d9",
]
WIDTH, HEIGHT = A4
MARGIN = 44
CONTENT = WIDTH - 2 * MARGIN
FONT = "MiningNoto"
BOLD = "MiningNotoBold"


def register_font():
    if FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(
            TTFont(FONT, str(PUBLIC_ROOT / "fonts" / "NotoSans.ttf"))
        )

    if BOLD not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(
            TTFont(BOLD, str(PUBLIC_ROOT / "fonts" / "NotoSans-Bold.ttf"))
        )
    pdfmetrics.registerFontFamily(
        FONT, normal=FONT, bold=BOLD, italic=FONT, boldItalic=BOLD
    )


def series_color(identifier: str):
    if identifier == "total":
        return colors.HexColor(PALETTE[0])
    value = 2166136261
    for char in identifier:
        value = ((value ^ ord(char)) * 16777619) & 0xFFFFFFFF
    return colors.HexColor(PALETTE[value % len(PALETTE)])


def number(value: float | None, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    if abs(value) >= 1e10:
        return f"{value:.3e}"
    return f"{value:,.{digits}f}"


def chart(
    dates: list[str],
    items: list[AnalyzedMine],
    mode: str,
    show_trend: bool,
    degree: int,
    height=205,
):
    drawing = Drawing(CONTENT, height)
    left, right, bottom, top = 43, CONTENT - 9, 30, height - 17
    n = len(dates)
    totals = [sum(s.values[i] for s in items) for i in range(n)]
    trend_total = [sum(s.trend[i] for s in items) for i in range(n)]
    actual = totals if mode == "stacked" else [v for s in items for v in s.values]
    trends = (
        (trend_total if mode == "stacked" else [v for s in items for v in s.trend])
        if show_trend
        else []
    )
    low, high = min([0] + trends), max([1] + actual + trends) * 1.1
    px = lambda i: (left + right) / 2 if n == 1 else left + i / (n - 1) * (right - left)
    py = lambda v: bottom + (v - low) / (high - low) * (top - bottom)

    def path(values, color, dashed=False):
        points = [
            coordinate
            for i, value in enumerate(values)
            for coordinate in (px(i), py(value))
        ]
        if n == 1:
            drawing.add(
                Circle(px(0), py(values[0]), 1.4, fillColor=color, strokeColor=None)
            )
        else:
            drawing.add(
                PolyLine(
                    points,
                    strokeColor=color,
                    strokeWidth=1.5,
                    fillColor=None,
                    strokeDashArray=[4, 3] if dashed else None,
                )
            )

    for i in range(5):
        value = low + (high - low) * i / 4
        drawing.add(
            Line(left, py(value), right, py(value), strokeColor=RULE, strokeWidth=0.5)
        )
        drawing.add(
            String(
                left - 7,
                py(value) - 2,
                (
                    f"{value/1000:.1f}k"
                    if abs(value) >= 1000 and abs(value) < 1e10
                    else number(value, 0)
                ),
                fontName=FONT,
                fontSize=7.4,
                textAnchor="end",
                fillColor=MUTED,
            )
        )
    for i in sorted(
        set(round(j * (n - 1) / max(1, min(5, n) - 1)) for j in range(min(5, n)))
    ):
        drawing.add(
            String(
                px(i),
                12,
                dates[i][5:],
                fontName=FONT,
                fontSize=7.6,
                textAnchor="middle",
                fillColor=MUTED,
            )
        )
    drawing.add(
        String(
            0, height - 6, "TONNES / DAY", fontName=FONT, fontSize=6.3, fillColor=MUTED
        )
    )
    cumulative = [0.0] * n
    for item in items:
        color = series_color(item.id)
        upper = (
            [a + b for a, b in zip(cumulative, item.values)]
            if mode == "stacked"
            else item.values
        )
        if mode == "stacked":
            pale = colors.Color(
                *(c * 0.3 + 0.7 for c in (color.red, color.green, color.blue))
            )
            points = [
                coordinate
                for i, value in enumerate(upper)
                for coordinate in (px(i), py(value))
            ]
            points += [
                coordinate
                for i in reversed(range(n))
                for coordinate in (px(i), py(cumulative[i]))
            ]
            if n > 1:
                drawing.add(Polygon(points, fillColor=pale, strokeColor=None))
            path(upper, color)
            cumulative = upper
        elif mode == "bar":
            width = min(8, (right - left) / max(n, 2) * 0.65) / len(items)
            for i, value in enumerate(item.values):
                drawing.add(
                    Rect(
                        px(i) - width / 2,
                        py(0),
                        max(0.1, width),
                        max(0.1, py(value) - py(0)),
                        fillColor=color,
                        strokeColor=None,
                    )
                )
        else:
            path(item.values, color)
        if show_trend and mode != "stacked":
            path(item.trend, TREND, True)
        for anomaly in item.analysis.anomalies:
            drawing.add(
                Circle(
                    px(anomaly.index),
                    py(upper[anomaly.index]),
                    2.7,
                    fillColor=SPIKE if anomaly.direction == "spike" else DROP,
                    strokeColor=colors.white,
                    strokeWidth=0.5,
                )
            )
    if show_trend and mode == "stacked":
        path(trend_total, TREND, True)
    return drawing


def context_chart(item: AnalyzedMine, flag: Anomaly):
    index = flag.index
    begin, end = max(0, index - 5), min(len(item.values), index + 6)
    values = item.values[begin:end]
    low, high = min(values), max(values)
    span = high - low or 1
    drawing = Drawing(CONTENT, 49)
    x = lambda i: 9 + i / max(1, len(values) - 1) * (CONTENT - 18)
    y = lambda v: 7 + (v - low) / span * 34
    points = [
        coordinate for i, value in enumerate(values) for coordinate in (x(i), y(value))
    ]
    if len(values) > 1:
        drawing.add(
            PolyLine(
                points,
                strokeColor=colors.HexColor("#a2b6cf"),
                strokeWidth=0.9,
                fillColor=None,
            )
        )
    drawing.add(
        Circle(
            x(index - begin),
            y(item.values[index]),
            2.5,
            fillColor=SPIKE if flag.direction == "spike" else DROP,
            strokeColor=None,
        )
    )
    return drawing, begin, end


def build_report(result: AnalysisResponse, request: ReportRequest) -> bytes:
    register_font()
    buffer = BytesIO()
    data, series = result.dataset, result.series
    fleet = series[0]
    period = f"{data.dates[0]} - {data.dates[-1]}"
    logo = ImageReader(str(PUBLIC_ROOT / "branding" / "weyland-yutani.png"))
    logo_width, logo_height = logo.getSize()

    class ReportDocument(SimpleDocTemplate):
        def afterFlowable(self, flowable):
            if hasattr(flowable, "report_outline"):
                title, key, level, closed = flowable.report_outline
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(title, key, level=level, closed=closed)

    document = ReportDocument(
        buffer,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=108,
        bottomMargin=48,
        title="Weyland-Yutani production report",
        author="Weyland-Yutani Corporation",
        subject=f"Daily mine output / {period}",
        pageCompression=1,
    )
    styles = {
        "body": ParagraphStyle(
            "Body", fontName=FONT, fontSize=8.5, leading=13, textColor=INK, spaceAfter=7
        ),
        "small": ParagraphStyle(
            "Small",
            fontName=FONT,
            fontSize=7.3,
            leading=11,
            textColor=MUTED,
            spaceAfter=5,
        ),
        "title": ParagraphStyle(
            "Title", fontName=BOLD, fontSize=31, leading=39, textColor=INK, spaceAfter=9
        ),
        "h1": ParagraphStyle(
            "H1",
            fontName=BOLD,
            fontSize=22,
            leading=28,
            textColor=INK,
            spaceAfter=12,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "H2",
            fontName=BOLD,
            fontSize=12,
            leading=17,
            textColor=INK,
            spaceBefore=14,
            spaceAfter=8,
            keepWithNext=True,
        ),
        "label": ParagraphStyle(
            "Label",
            fontName=BOLD,
            fontSize=6.8,
            leading=10,
            textColor=MUTED,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "cell": ParagraphStyle(
            "Cell", fontName=FONT, fontSize=7.8, leading=11, textColor=INK
        ),
        "cellBold": ParagraphStyle(
            "CellBold", fontName=BOLD, fontSize=7.8, leading=11, textColor=INK
        ),
        "header": ParagraphStyle(
            "Header", fontName=BOLD, fontSize=7.2, leading=10, textColor=colors.white
        ),
        "headerRight": ParagraphStyle(
            "HeaderRight",
            fontName=BOLD,
            fontSize=7.2,
            leading=10,
            textColor=colors.white,
            alignment=TA_RIGHT,
        ),
        "numeric": ParagraphStyle(
            "Numeric",
            fontName=FONT,
            fontSize=7.8,
            leading=11,
            textColor=INK,
            alignment=TA_RIGHT,
        ),
        "numericBold": ParagraphStyle(
            "NumericBold",
            fontName=BOLD,
            fontSize=7.8,
            leading=11,
            textColor=INK,
            alignment=TA_RIGHT,
        ),
        "value": ParagraphStyle(
            "Value", fontName=BOLD, fontSize=19, leading=26, textColor=INK
        ),
        "legend": ParagraphStyle(
            "Legend", fontName=FONT, fontSize=7.2, leading=10, textColor=MUTED
        ),
        "anomalyName": ParagraphStyle(
            "AnomalyName",
            fontName=BOLD,
            fontSize=11,
            leading=15,
            textColor=INK,
            spaceAfter=6,
        ),
        "spike": ParagraphStyle(
            "Spike",
            fontName=BOLD,
            fontSize=8,
            leading=12,
            textColor=SPIKE,
            backColor=colors.HexColor("#fff0f0"),
            borderPadding=6,
            spaceAfter=11,
        ),
        "drop": ParagraphStyle(
            "Drop",
            fontName=BOLD,
            fontSize=8,
            leading=12,
            textColor=DROP,
            backColor=colors.HexColor("#eaf6fa"),
            borderPadding=6,
            spaceAfter=11,
        ),
    }
    outline_count = 0

    def p(value, style="body"):
        return Paragraph(escape(str(value)).replace("\n", "<br/>"), styles[style])

    def heading(value, level=0, style="h1", closed=False):
        nonlocal outline_count
        outline_count += 1
        paragraph = p(value, style)
        paragraph.report_outline = (
            str(value),
            f"report-section-{outline_count}",
            level,
            closed,
        )
        return paragraph

    def table(headers, rows, widths, numeric=(), highlight_first=False):
        cells = [
            [
                p(value, "headerRight" if i in numeric else "header")
                for i, value in enumerate(headers)
            ]
        ]
        for index, row in enumerate(rows):
            cells.append(
                [
                    p(
                        value,
                        (
                            ("numericBold" if i in numeric else "cellBold")
                            if highlight_first and index == 0
                            else ("numeric" if i in numeric else "cell")
                        ),
                    )
                    for i, value in enumerate(row)
                ]
            )
        item = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
        commands = [
            ("BACKGROUND", (0, 0), (-1, 0), INK),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
            ("LINEBELOW", (0, 0), (-1, -1), 0.35, RULE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]
        if highlight_first:
            commands.append(("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#fff9dc")))
        item.setStyle(TableStyle(commands))
        return item

    def legend(items, show_trend, names=True):
        entries = [
            (series_color(item.id), item.name if names else "Output", "line")
            for item in items
        ]
        entries += [(SPIKE, "Spike", "dot"), (DROP, "Drop", "dot")]
        if show_trend:
            entries.append((TREND, "Polynomial trend", "dash"))
        rows = []
        for begin in range(0, len(entries), 2):
            row = []
            for color, title, kind in entries[begin : begin + 2]:
                swatch = Drawing(15, 11)
                if kind == "dot":
                    swatch.add(Circle(5, 5, 2.4, fillColor=color, strokeColor=None))
                else:
                    swatch.add(
                        Line(
                            0,
                            5,
                            11,
                            5,
                            strokeColor=color,
                            strokeWidth=1.6,
                            strokeDashArray=[3, 2] if kind == "dash" else None,
                        )
                    )
                row.extend([swatch, p(title, "legend")])
            if len(row) == 2:
                row.extend(["", ""])
            rows.append(row)
        item = Table(
            rows, colWidths=[16, CONTENT / 2 - 16, 16, CONTENT / 2 - 16], hAlign="LEFT"
        )
        item.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 1),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        return item

    def page_header(canvas, doc):
        canvas.saveState()
        cover = doc.page == 1
        band = 144 if cover else 74
        canvas.setFillColor(colors.black)
        canvas.rect(0, HEIGHT - band, WIDTH, band, fill=1, stroke=0)
        width = 222 if cover else 110
        height = width * logo_height / logo_width
        canvas.drawImage(
            logo,
            MARGIN,
            HEIGHT - (128 if cover else 62),
            width=width,
            height=height,
            mask="auto",
        )
        canvas.setFillColor(YELLOW)
        canvas.rect(0, HEIGHT - band - 3, WIDTH, 3, fill=1, stroke=0)
        canvas.setFont(BOLD, 11 if cover else 10)
        canvas.setFillColor(YELLOW if cover else colors.white)
        canvas.drawRightString(
            WIDTH - MARGIN, HEIGHT - (52 if cover else 28), "PRODUCTION REPORT"
        )
        canvas.setFont(FONT, 8)
        canvas.setFillColor(colors.HexColor("#c5cbd4"))
        canvas.drawRightString(WIDTH - MARGIN, HEIGHT - (74 if cover else 47), period)
        if cover:
            canvas.drawRightString(
                WIDTH - MARGIN,
                HEIGHT - 94,
                f"{len(data.mines)} mines / {len(data.dates)} days",
            )
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(MARGIN, 36, WIDTH - MARGIN, 36)
        canvas.setFont(FONT, 6.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, 24, "Daily production / metric tonnes")
        canvas.setFont(BOLD, 6.5)
        canvas.drawRightString(WIDTH - MARGIN, 24, f"PAGE {doc.page:02d}")
        canvas.restoreState()

    metrics = [
        ("TOTAL EXTRACTION", number(fleet.analysis.summary.sum / 1000, 1) + " kt"),
        ("MEAN DAILY OUTPUT", number(fleet.analysis.summary.mean, 0) + " t"),
        ("DAILY SAMPLE SD", number(fleet.analysis.summary.sd, 0) + " t"),
        ("FLAGGED MINE-DAYS", str(result.flagged_mine_days)),
    ]
    cards = Table(
        [
            [p(label, "label") for label, _ in metrics],
            [p(value, "value") for _, value in metrics],
        ],
        colWidths=[CONTENT / 4] * 4,
        hAlign="LEFT",
    )
    cards.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("LINEABOVE", (0, 0), (-1, 0), 2, YELLOW),
                ("LINEBEFORE", (1, 0), (-1, -1), 0.5, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, 0), 11),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
                ("TOPPADDING", (0, 1), (-1, 1), 1),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
            ]
        )
    )
    provenance = [
        p("SNAPSHOT PROVENANCE", "label"),
        p(data.source, "small"),
        p(
            "Generated " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "small",
        ),
    ]
    if request.snapshot_at:
        provenance.append(p("Source refreshed: " + request.snapshot_at, "small"))
    cover_items = series[1:] if request.mode == "stacked" else [fleet]
    story = [
        Spacer(1, 42),
        heading("Daily production", style="title"),
        p(
            f"{len(data.mines)} mines / {len(data.dates)} daily observations / metric tonnes",
            "small",
        ),
        Spacer(1, 9),
        KeepTogether(provenance),
        Spacer(1, 12),
        cards,
        p("Fleet daily output", "h2"),
        chart(
            data.dates,
            cover_items,
            request.mode,
            request.trend,
            result.effective_degree,
            height=200 if request.mode == "stacked" and len(data.mines) > 6 else 230,
        ),
        legend(cover_items, request.trend),
        Spacer(1, 5),
        p(
            f"{request.mode.title()} chart / "
            + (
                f"polynomial degree {result.effective_degree}"
                if request.trend
                else "trend hidden"
            ),
            "small",
        ),
        PageBreak(),
        p("01 / STATISTICS", "label"),
        heading("Summary statistics"),
        p(period + " / tonnes per day", "small"),
        Spacer(1, 4),
        table(
            ["Mine / series", "Mean", "Sample SD", "Median", "IQR", "Flags"],
            [
                [
                    item.name,
                    number(item.analysis.summary.mean),
                    number(item.analysis.summary.sd),
                    number(item.analysis.summary.median),
                    number(item.analysis.summary.iqr),
                    str(len(item.analysis.anomalies)),
                ]
                for item in series
            ],
            [
                CONTENT * 0.27,
                CONTENT * 0.155,
                CONTENT * 0.165,
                CONTENT * 0.155,
                CONTENT * 0.155,
                CONTENT * 0.10,
            ],
            numeric=(1, 2, 3, 4, 5),
            highlight_first=True,
        ),
        p("Detector configuration", "h2"),
    ]
    settings = request.settings
    story += [
        table(
            ["Test", "Parameters", "Enabled"],
            [
                [
                    "IQR",
                    f"k = {settings.iqr_multiplier:g}; Q1 - k*IQR to Q3 + k*IQR",
                    "Yes" if "IQR" in settings.enabled else "No",
                ],
                [
                    "Z-score",
                    f"Absolute z > {settings.z_threshold:g}; sample SD",
                    "Yes" if "Z-score" in settings.enabled else "No",
                ],
                [
                    "Moving average",
                    f"{settings.ma_window} prior days; distance > {settings.ma_percent:g}%; full window required",
                    "Yes" if "Moving average" in settings.enabled else "No",
                ],
                [
                    "Grubbs",
                    f"Two-sided; alpha = {settings.grubbs_alpha:g}; max passes = {settings.grubbs_max}",
                    "Yes" if "Grubbs" in settings.enabled else "No",
                ],
            ],
            [90, CONTENT - 145, 55],
        ),
        p("Interpretation", "h2"),
        p(
            "Sample SD uses n-1; a single observation has no defined sample SD. Quartiles use linear interpolation (type 7). Fleet totals are summed by date before analysis. Polynomial fits include every observation and reduce their degree for short windows.",
            "small",
        ),
        p(
            "Moving averages exclude the current day and require a complete prior window. Positive output after an all-zero baseline has unbounded percent distance. Grubbs assumes independent, approximately normal data; seasonal output and repeated passes are exploratory. A flag does not establish an operational cause.",
            "small",
        ),
        p(
            "Reference: NIST/SEMATECH e-Handbook, Grubbs test. https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h1.htm",
            "small",
        ),
    ]

    for index, item in enumerate(series[1:], 1):
        summary = item.analysis.summary
        story += [PageBreak()]
        if index == 1:
            story += [heading("Mine profiles", style="label", closed=True)]
        story += [
            p(f"02 / MINE {index:02d} OF {len(data.mines)}", "label"),
            heading(item.name, level=1),
            p(f"{period} / {number(summary.sum, 0)} tonnes extracted", "small"),
            Spacer(1, 5),
            table(
                ["Mean (t/day)", "Sample SD", "Median (t/day)", "IQR (t/day)"],
                [
                    [
                        number(summary.mean),
                        number(summary.sd),
                        number(summary.median),
                        number(summary.iqr),
                    ]
                ],
                [CONTENT / 4] * 4,
                numeric=(0, 1, 2, 3),
                highlight_first=True,
            ),
            Spacer(1, 15),
            chart(
                data.dates,
                [item],
                request.mode,
                request.trend,
                result.effective_degree,
                height=230,
            ),
            legend([item], request.trend, names=False),
            p(f"Flagged observations: {len(item.analysis.anomalies)}", "h2"),
        ]
        if item.analysis.anomalies:
            story += [
                table(
                    ["Date", "Type", "Output (t)", "Detected by"],
                    [
                        [
                            data.dates[a.index],
                            a.direction,
                            number(a.value),
                            ", ".join(e.test for e in a.evidence),
                        ]
                        for a in item.analysis.anomalies[:5]
                    ],
                    [77, 49, 80, CONTENT - 206],
                    numeric=(2,),
                ),
                Spacer(1, 7),
                p(
                    "First five flags shown. Every flagged observation has its own section in the anomaly appendix.",
                    "small",
                ),
            ]
        else:
            story.append(
                p("No observations exceeded the enabled detector thresholds.", "small")
            )

    all_flags = [(item, flag) for item in series for flag in item.analysis.anomalies]
    story += [
        PageBreak(),
        p("03 / ANOMALIES", "label"),
        heading("Anomaly appendix", closed=True),
        p(
            f"{len(all_flags)} unique series-day flags, including the fleet total. Tests on the same observation appear together. Direction compares output with the preceding moving average or, during warm-up, the series mean. Each test retains its own reference.",
            "small",
        ),
    ]
    if not all_flags:
        story.append(p("No anomalies were detected with the current settings."))
    for index, (item, flag) in enumerate(all_flags, 1):
        rows = []
        for entry in flag.evidence:
            unit = "%" if entry.test == "Moving average" else ""
            score = "unbounded" if entry.unbounded else number(entry.score, 3)
            rows.append(
                [
                    entry.test,
                    score + unit,
                    number(entry.threshold, 3) + unit,
                    number(entry.baseline),
                    entry.detail,
                ]
            )
        local, begin, end = context_chart(item, flag)
        band = p(
            f"{index:03d} / {flag.direction.upper()} / {data.dates[flag.index]}",
            flag.direction,
        )
        name = heading(item.name, level=1, style="anomalyName")
        name.report_outline = (
            f"{index:03d} / {item.name} / {data.dates[flag.index]}",
            name.report_outline[1],
            1,
            False,
        )
        story.append(
            KeepTogether(
                [
                    Spacer(1, 13),
                    band,
                    name,
                    p(
                        f"Output: {number(flag.value)} t / baseline: {number(flag.baseline)} t / {len(flag.evidence)} detector(s)",
                        "small",
                    ),
                    table(
                        ["Test", "Score", "Limit", "Reference (t/day)", "Evidence"],
                        rows,
                        [64, 65, 65, 82, CONTENT - 276],
                        numeric=(1, 2, 3),
                    ),
                    Spacer(1, 7),
                    local,
                    p(
                        f"Local context: {data.dates[begin]} to {data.dates[end-1]} / independent vertical scale.",
                        "small",
                    ),
                ]
            )
        )
    document.build(story, onFirstPage=page_header, onLaterPages=page_header)
    return buffer.getvalue()
