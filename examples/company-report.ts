// A long slide deck: a fictional company's annual report on 16:9 slides, fourteen of them, with KPI cards,
// column, line, bar, pie and doughnut charts, a financial table, a roadmap drawn from shapes, images
// generated in code, a quote and two text columns. The company, people and figures are invented.
// Run: bun run examples/company-report.ts (writes company-report.pdf and company-report.html to the working directory).
import { writeFile } from "node:fs/promises";
import pptxgen from "@pdflapas/pptxgenjs";
import type PptxGenJS from "pptxgenjs";

// The theme: every colour on every slide comes from here.
const THEME = {
    navy: "1F3A5F",
    teal: "1A9E8F",
    amber: "F2A541",
    coral: "E4572E",
    sky: "5DA9E9",
    ink: "22303C",
    grey: "5B6770",
    rule: "D5DAE0",
    light: "F4F6F8",
    white: "FFFFFF",
} as const;
const SERIES = [THEME.navy, THEME.teal, THEME.amber, THEME.coral, THEME.sky];
const FONT = "Arial";
const COMPANY = "Quillfeather Dynamics";
// LAYOUT_16x9, PptxGenJS's default: 10 x 5.625 in.
const SLIDE = { w: 10, h: 5.625, margin: 0.5 } as const;
const CONTENT_W = SLIDE.w - 2 * SLIDE.margin;
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

/** An SVG drawn in code, as the `data` string addImage takes; no file and no network. */
function svgData(width: number, height: number, body: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`;

    return `image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** A content slide: the title, a theme rule under it, the footer and the slide number. */
function contentSlide(pres: pptxgen, title: string, kicker: string): PptxGenJS.Slide {
    const slide = pres.addSlide();

    slide.background = { color: THEME.white };
    slide.addText(kicker.toUpperCase(), { x: SLIDE.margin, y: 0.25, w: CONTENT_W, h: 0.25, fontFace: FONT, fontSize: 9, bold: true, color: THEME.teal, charSpacing: 1, margin: 0 });
    slide.addText(title, { x: SLIDE.margin, y: 0.5, w: CONTENT_W, h: 0.5, fontFace: FONT, fontSize: 22, bold: true, color: THEME.navy, margin: 0, valign: "middle" });
    slide.addShape("rect", { x: SLIDE.margin, y: 1.05, w: 0.8, h: 0.05, fill: { color: THEME.amber } });
    slide.addShape("line", { x: SLIDE.margin, y: SLIDE.h - 0.4, w: CONTENT_W, h: 0, line: { color: THEME.rule, width: 0.75 } });
    slide.addText(`${COMPANY}  |  Annual report 2026  |  Fictional company, invented figures`, { x: SLIDE.margin, y: SLIDE.h - 0.36, w: 7, h: 0.28, fontFace: FONT, fontSize: 8, color: THEME.grey, margin: 0, valign: "middle" });
    slide.slideNumber = { x: SLIDE.w - SLIDE.margin - 0.8, y: SLIDE.h - 0.36, w: 0.8, h: 0.28, fontFace: FONT, fontSize: 8, color: THEME.grey, align: "right", valign: "middle", margin: 0 };

    return slide;
}

/** The deck, built on `pres`. Exported so the same deck can be rendered with another backend. */
export function buildCompanyReport(pres: pptxgen): pptxgen {
    pres.layout = "LAYOUT_16x9";
    pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
    pres.title = `${COMPANY} annual report 2026 (fictional)`;
    pres.company = COMPANY;

    const logo = svgData(100, 100, `<circle cx="50" cy="50" r="46" fill="#${THEME.white}"/><circle cx="50" cy="50" r="30" fill="#${THEME.teal}"/><circle cx="50" cy="50" r="16" fill="#${THEME.white}"/><polygon points="58,58 86,86 72,90 50,66" fill="#${THEME.amber}"/>`);
    const chartText = { fontFace: FONT, fontSize: 9, titleFontFace: FONT, titleFontSize: 11, titleColor: THEME.navy, legendFontFace: FONT, legendFontSize: 9 } as const;

    // 1. Title slide.
    const title = pres.addSlide();

    title.background = { color: THEME.navy };
    title.addShape("ellipse", { x: 6.4, y: -1.2, w: 5.2, h: 5.2, fill: { color: THEME.teal, transparency: 70 } });
    title.addShape("ellipse", { x: 7.6, y: 2.6, w: 3.6, h: 3.6, fill: { color: THEME.sky, transparency: 75 } });
    title.addImage({ data: logo, x: SLIDE.margin, y: 0.5, w: 0.8, h: 0.8 });
    title.addText(COMPANY, { x: 1.45, y: 0.6, w: 5, h: 0.6, fontFace: FONT, fontSize: 16, bold: true, color: THEME.white, margin: 0, valign: "middle" });
    title.addText("Annual Report 2026", { x: SLIDE.margin, y: 1.9, w: 7, h: 1, fontFace: FONT, fontSize: 44, bold: true, color: THEME.white, margin: 0 });
    title.addShape("rect", { x: SLIDE.margin, y: 3.0, w: 1.2, h: 0.08, fill: { color: THEME.amber } });
    title.addText(
        [
            { text: "Building steady growth", options: { fontSize: 20, color: THEME.white, breakLine: true } },
            { text: "Results for the year ended 31 December 2026", options: { fontSize: 12, color: "B8C7D9" } },
        ],
        { x: SLIDE.margin, y: 3.25, w: 7, h: 0.9, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 4 },
    );
    title.addText("A fictional company. Every name and number in this deck is invented.", { x: SLIDE.margin, y: 4.85, w: 7, h: 0.3, fontFace: FONT, fontSize: 9, italic: true, color: "B8C7D9", margin: 0 });

    // 2. Agenda: numbered circles (text in an ellipse) beside their topics.
    const agenda = contentSlide(pres, "Agenda", "Annual report 2026");
    const topics = [
        ["Year in numbers", "Revenue, margin, customers and satisfaction"],
        ["Growth", "Quarterly revenue, users and the regional mix"],
        ["Financial statements", "The income statement with subtotals"],
        ["Roadmap", "What ships in 2027, quarter by quarter"],
        ["Products and people", "The portfolio, the team and our commitments"],
        ["Outlook", "Targets for the coming year"],
    ] as const;

    for (const [index, [topic, detail]] of topics.entries()) {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = SLIDE.margin + column * 4.6;
        const y = 1.45 + row * 1.2;

        agenda.addText(String(index + 1), { shape: "ellipse", x, y, w: 0.7, h: 0.7, fill: { color: index % 2 ? THEME.teal : THEME.navy }, fontFace: FONT, fontSize: 18, bold: true, color: THEME.white, align: "center", valign: "middle" });
        agenda.addText(
            [
                { text: topic, options: { fontSize: 15, bold: true, color: THEME.ink, breakLine: true } },
                { text: detail, options: { fontSize: 10.5, color: THEME.grey } },
            ],
            { x: x + 0.9, y: y - 0.05, w: 3.5, h: 0.8, fontFace: FONT, margin: 0, valign: "middle", paraSpaceAfter: 2 },
        );
    }

    // 3. KPI cards: rounded rectangles with a big number, a label and the change on last year.
    const kpis = contentSlide(pres, "The year in numbers", "Highlights");
    const cards = [
        { value: "$412.6M", label: "Revenue", change: "+14.2% on 2025", color: THEME.navy },
        { value: "18.4%", label: "Operating margin", change: "+2.1 points", color: THEME.teal },
        { value: "12,840", label: "Business customers", change: "+1,910 net new", color: THEME.amber },
        { value: "61", label: "Net promoter score", change: "+7 points", color: THEME.coral },
    ];
    const cardW = (CONTENT_W - 3 * 0.25) / 4;

    for (const [index, card] of cards.entries()) {
        const x = SLIDE.margin + index * (cardW + 0.25);

        kpis.addShape("roundRect", { x, y: 1.5, w: cardW, h: 2.3, fill: { color: THEME.light }, line: { color: THEME.rule, width: 0.75 }, rectRadius: 0.12 });
        kpis.addShape("rect", { x: x + 0.25, y: 1.75, w: 0.5, h: 0.06, fill: { color: card.color } });
        kpis.addText(
            [
                { text: card.value, options: { fontSize: 30, bold: true, color: card.color, breakLine: true } },
                { text: card.label, options: { fontSize: 12, bold: true, color: THEME.ink, breakLine: true } },
                { text: card.change, options: { fontSize: 10, color: THEME.grey } },
            ],
            { x: x + 0.25, y: 1.95, w: cardW - 0.4, h: 1.65, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 4 },
        );
    }

    kpis.addText([{ text: "Every headline measure improved. ", options: { bold: true, color: THEME.navy } }, { text: "Growth came from existing customers buying more seats, while a leaner cost base lifted the margin for the third year in a row." }], {
        x: SLIDE.margin,
        y: 4.1,
        w: CONTENT_W,
        h: 0.7,
        fontFace: FONT,
        fontSize: 12,
        color: THEME.ink,
        margin: 0,
        valign: "top",
    });

    // 4. Revenue by quarter: a clustered column chart.
    const revenue = contentSlide(pres, "Revenue grew in every quarter", "Growth");

    revenue.addChart(
        "bar",
        [
            { name: "2025", labels: QUARTERS, values: [82.4, 86.9, 91.2, 100.7] },
            { name: "2026", labels: QUARTERS, values: [93.1, 99.8, 104.5, 115.2] },
        ],
        {
            ...chartText,
            x: SLIDE.margin,
            y: 1.3,
            w: 5.8,
            h: 3.75,
            barDir: "col",
            barGapWidthPct: 60,
            chartColors: [THEME.sky, THEME.navy],
            showLegend: true,
            legendPos: "b",
            showTitle: true,
            title: "Revenue by quarter (USD millions)",
            valAxisMinVal: 0,
            valAxisMaxVal: 120,
            valAxisMajorUnit: 20,
            valAxisLabelFormatCode: "$#,##0",
            valGridLine: { color: THEME.rule, size: 0.5 },
        },
    );
    revenue.addText(
        [
            { text: "+14.2%", options: { fontSize: 28, bold: true, color: THEME.teal, breakLine: true } },
            { text: "full-year growth", options: { fontSize: 11, color: THEME.grey, breakLine: true } },
            { text: "Q4 was the strongest quarter on record, at ", options: { fontSize: 11, color: THEME.ink } },
            { text: "$115.2M", options: { fontSize: 11, bold: true, color: THEME.navy } },
            { text: ".", options: { fontSize: 11, color: THEME.ink, breakLine: true } },
            { text: "Renewals stayed above 95% all year.", options: { fontSize: 11, color: THEME.ink } },
        ],
        { x: 6.6, y: 1.5, w: 2.9, h: 3.3, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 6 },
    );

    // 5. Users and seats: a line chart with markers.
    const users = contentSlide(pres, "Active users kept climbing", "Growth");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    users.addChart(
        "line",
        [
            { name: "Monthly active users (thousands)", labels: months, values: [182, 188, 195, 199, 207, 214, 219, 228, 236, 243, 251, 262] },
            { name: "Paid seats (thousands)", labels: months, values: [121, 124, 128, 131, 135, 139, 142, 148, 153, 158, 163, 170] },
        ],
        {
            ...chartText,
            x: SLIDE.margin,
            y: 1.3,
            w: CONTENT_W,
            h: 3.8,
            chartColors: [THEME.navy, THEME.teal],
            lineSize: 2,
            lineDataSymbol: "circle",
            lineDataSymbolSize: 6,
            showLegend: true,
            legendPos: "t",
            valAxisMinVal: 100,
            valAxisMaxVal: 280,
            valAxisMajorUnit: 30,
            showValAxisTitle: true,
            valAxisTitle: "Thousands",
            valAxisTitleFontSize: 9,
            valGridLine: { color: THEME.rule, size: 0.5 },
        },
    );

    // 6. Revenue mix: a doughnut by segment and a pie by region.
    const mix = contentSlide(pres, "Where the revenue came from", "Growth");

    mix.addChart("doughnut", [{ name: "Segment", labels: ["Platform", "Services", "Hardware", "Training"], values: [58, 22, 14, 6] }], {
        ...chartText,
        x: SLIDE.margin,
        y: 1.25,
        w: 4.4,
        h: 3.85,
        chartColors: SERIES,
        holeSize: 55,
        showLegend: true,
        legendPos: "b",
        showTitle: true,
        title: "By segment (%)",
    });
    mix.addChart("pie", [{ name: "Region", labels: ["North", "South", "East", "West", "Overseas"], values: [34, 18, 21, 15, 12] }], {
        ...chartText,
        x: 5.1,
        y: 1.25,
        w: 4.4,
        h: 3.85,
        chartColors: SERIES,
        firstSliceAng: 30,
        showLegend: true,
        legendPos: "b",
        showTitle: true,
        title: "By region (%)",
    });

    // 7. Income statement: right-aligned numbers, subtotal rows with a heavier top border.
    const statement = contentSlide(pres, "Income statement", "Financial statements");
    const thin = { type: "solid", pt: 0.5, color: THEME.rule } as const;
    const heavy = { type: "solid", pt: 1.5, color: THEME.navy } as const;
    const lines: readonly (readonly [string, number, number, "line" | "subtotal" | "total"])[] = [
        ["Platform subscriptions", 208.4, 239.3, "line"],
        ["Professional services", 81.6, 90.8, "line"],
        ["Hardware", 52.1, 57.8, "line"],
        ["Training", 19.1, 24.7, "line"],
        ["Total revenue", 361.2, 412.6, "subtotal"],
        ["Cost of revenue", -151.7, -165.0, "line"],
        ["Gross profit", 209.5, 247.6, "subtotal"],
        ["Research and development", -64.9, -71.4, "line"],
        ["Sales and marketing", -58.3, -63.2, "line"],
        ["General and administrative", -27.2, -37.1, "line"],
        ["Operating income", 59.1, 75.9, "subtotal"],
        ["Net finance costs and tax", -15.4, -19.6, "line"],
        ["Net income", 43.7, 56.3, "total"],
    ];
    const money = (value: number) => (value < 0 ? `(${Math.abs(value).toFixed(1)})` : value.toFixed(1));
    const headerCell = { bold: true, color: THEME.white, fill: { color: THEME.navy }, align: "right" } as const;
    const statementRows: PptxGenJS.TableRow[] = [
        [
            { text: "USD millions", options: { ...headerCell, align: "left" } },
            { text: "FY2025", options: headerCell },
            { text: "FY2026", options: headerCell },
            { text: "Change", options: headerCell },
        ],
    ];

    for (const [label, previous, current, kind] of lines) {
        const change = ((current - previous) / Math.abs(previous)) * 100;
        const strong = kind !== "line";
        const fill = kind === "total" ? THEME.navy : kind === "subtotal" ? THEME.light : THEME.white;
        const color = kind === "total" ? THEME.white : THEME.ink;
        const border: PptxGenJS.TableCellProps["border"] = strong ? [heavy, thin, thin, thin] : [thin, thin, thin, thin];
        const cell = { bold: strong, color, fill: { color: fill }, border, align: "right" } as const;

        statementRows.push([
            { text: label, options: { ...cell, align: "left", margin: [2, 6, 2, strong ? 6 : 16] } },
            { text: money(previous), options: cell },
            { text: money(current), options: cell },
            { text: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`, options: { ...cell, color: kind === "total" ? THEME.white : change >= 0 ? THEME.teal : THEME.coral } },
        ]);
    }

    statement.addTable(statementRows, { x: SLIDE.margin, y: 1.3, w: 6.2, colW: [3.2, 1, 1, 1], fontFace: FONT, fontSize: 9.5, border: thin, valign: "middle", margin: [2, 6, 2, 6] });
    statement.addText(
        [
            { text: "Reading the statement", options: { bold: true, color: THEME.navy, fontSize: 12, breakLine: true } },
            { text: "Figures in brackets are costs.", options: { bullet: true, breakLine: true } },
            { text: "Gross margin rose to ", options: { bullet: true } },
            { text: "60.0%", options: { bold: true, color: THEME.teal } },
            { text: " from 58.0%.", options: { breakLine: true } },
            { text: "General and administrative costs include a one-off office move.", options: { bullet: true, breakLine: true } },
            { text: "Net income grew ", options: { bullet: true } },
            { text: "28.8%", options: { bold: true, color: THEME.teal } },
            { text: "." },
        ],
        { x: 7.0, y: 1.3, w: 2.5, h: 3.6, fontFace: FONT, fontSize: 10, color: THEME.ink, margin: 0, valign: "top", paraSpaceAfter: 5 },
    );

    // 8. Regional performance: a horizontal bar chart.
    const regions = contentSlide(pres, "Growth by region", "Growth");

    regions.addChart(
        "bar",
        [
            { name: "2025", labels: ["Overseas", "West", "East", "South", "North"], values: [38.2, 55.9, 77.4, 66.1, 123.6] },
            { name: "2026", labels: ["Overseas", "West", "East", "South", "North"], values: [49.5, 61.9, 86.6, 74.3, 140.3] },
        ],
        {
            ...chartText,
            x: SLIDE.margin,
            y: 1.3,
            w: 6,
            h: 3.8,
            barDir: "bar",
            barGapWidthPct: 50,
            chartColors: [THEME.amber, THEME.teal],
            showLegend: true,
            legendPos: "b",
            valAxisMinVal: 0,
            valAxisMaxVal: 150,
            valAxisMajorUnit: 25,
            valAxisLabelFormatCode: "$#,##0",
            valGridLine: { color: THEME.rule, size: 0.5 },
        },
    );
    regions.addText(
        [
            { text: "Overseas", options: { bold: true, color: THEME.navy, fontSize: 14, breakLine: true } },
            { text: "grew fastest, up 29.6%, after two new partner agreements.", options: { breakLine: true } },
            { text: "North", options: { bold: true, color: THEME.navy, fontSize: 14, breakLine: true } },
            { text: "remains the largest region, at a third of revenue." },
        ],
        { x: 6.9, y: 1.5, w: 2.6, h: 3.2, fontFace: FONT, fontSize: 11, color: THEME.ink, margin: 0, valign: "top", paraSpaceAfter: 6 },
    );

    // 9. Roadmap: quarter chevrons, a time line with milestones, and connector lines to their labels.
    const roadmap = contentSlide(pres, "Roadmap 2027", "Roadmap");
    const chevronW = (CONTENT_W + 0.3) / 4;
    const milestones = [
        { x: 1.3, label: "Platform 5.0", detail: "New workflow engine", above: true },
        { x: 3.0, label: "Partner portal", detail: "Self-service onboarding", above: false },
        { x: 4.6, label: "Region: Overseas II", detail: "Second data centre", above: true },
        { x: 6.3, label: "Mobile app 2", detail: "Offline mode", above: false },
        { x: 8.2, label: "Analytics suite", detail: "General availability", above: true },
    ];

    for (const [index, quarter] of QUARTERS.entries()) {
        roadmap.addText(`${quarter} 2027`, {
            shape: index === 0 ? "homePlate" : "chevron",
            x: SLIDE.margin + index * (chevronW - 0.1),
            y: 1.35,
            w: chevronW,
            h: 0.5,
            fill: { color: SERIES[index] ?? THEME.navy },
            fontFace: FONT,
            fontSize: 12,
            bold: true,
            color: THEME.white,
            align: "center",
            valign: "middle",
        });
    }

    roadmap.addShape("line", { x: SLIDE.margin, y: 3.4, w: CONTENT_W, h: 0, line: { color: THEME.grey, width: 2, endArrowType: "triangle" } });

    for (const milestone of milestones) {
        const labelY = milestone.above ? 2.2 : 4.0;

        roadmap.addShape("line", { x: milestone.x, y: milestone.above ? 2.85 : 3.5, w: 0, h: 0.45, line: { color: THEME.teal, width: 1, dashType: "dash", beginArrowType: milestone.above ? "none" : "oval", endArrowType: milestone.above ? "oval" : "none" } });
        roadmap.addShape("ellipse", { x: milestone.x - 0.1, y: 3.3, w: 0.2, h: 0.2, fill: { color: THEME.amber }, line: { color: THEME.white, width: 1.5 } });
        roadmap.addText(
            [
                { text: milestone.label, options: { bold: true, color: THEME.navy, breakLine: true } },
                { text: milestone.detail, options: { color: THEME.grey, fontSize: 9 } },
            ],
            { x: milestone.x - 0.8, y: labelY, w: 1.6, h: 0.65, fontFace: FONT, fontSize: 10.5, align: "center", valign: milestone.above ? "bottom" : "top", margin: 0 },
        );
    }

    // 10. Products: three cards, each with an illustration generated in code as SVG.
    const products = contentSlide(pres, "Product portfolio", "Products and people");
    const portfolio = [
        {
            name: "Quill Platform",
            text: "Workflow automation for mid-sized teams. 58% of revenue.",
            art: `<rect width="160" height="100" fill="#${THEME.light}"/><rect x="20" y="20" width="50" height="30" rx="4" fill="#${THEME.navy}"/><rect x="90" y="20" width="50" height="30" rx="4" fill="#${THEME.teal}"/><rect x="55" y="62" width="50" height="26" rx="4" fill="#${THEME.amber}"/><path d="M70 35 L90 35 M45 50 L70 62 M115 50 L90 62" stroke="#${THEME.grey}" stroke-width="3" fill="none"/>`,
        },
        {
            name: "Feather Services",
            text: "Implementation and support by certified partners. 22% of revenue.",
            art: `<rect width="160" height="100" fill="#${THEME.light}"/><circle cx="55" cy="40" r="16" fill="#${THEME.navy}"/><circle cx="105" cy="40" r="16" fill="#${THEME.teal}"/><rect x="30" y="62" width="50" height="26" rx="12" fill="#${THEME.navy}"/><rect x="80" y="62" width="50" height="26" rx="12" fill="#${THEME.teal}"/>`,
        },
        {
            name: "Inkwell Devices",
            text: "Rugged tablets and scanners for field teams. 14% of revenue.",
            art: `<rect width="160" height="100" fill="#${THEME.light}"/><rect x="50" y="12" width="60" height="78" rx="8" fill="#${THEME.ink}"/><rect x="56" y="20" width="48" height="58" fill="#${THEME.sky}"/><circle cx="80" cy="84" r="3" fill="#${THEME.white}"/><polygon points="62,70 76,46 86,60 92,52 100,70" fill="#${THEME.white}"/>`,
        },
    ];
    const productW = (CONTENT_W - 2 * 0.3) / 3;

    for (const [index, product] of portfolio.entries()) {
        const x = SLIDE.margin + index * (productW + 0.3);

        products.addShape("rect", { x, y: 1.3, w: productW, h: 3.6, fill: { color: THEME.white }, line: { color: THEME.rule, width: 0.75 }, shadow: { type: "outer", color: "000000", opacity: 0.18, blur: 6, offset: 2, angle: 90 } });
        products.addImage({ data: svgData(160, 100, product.art), x: x + 0.15, y: 1.45, w: productW - 0.3, h: (productW - 0.3) * 0.625 });
        products.addText(
            [
                { text: product.name, options: { bold: true, fontSize: 14, color: THEME.navy, breakLine: true } },
                { text: product.text, options: { fontSize: 10.5, color: THEME.ink } },
            ],
            { x: x + 0.15, y: 3.3, w: productW - 0.3, h: 1.45, fontFace: FONT, margin: 0, valign: "top", paraSpaceAfter: 4 },
        );
    }

    // 11. A quote slide.
    const quote = pres.addSlide();

    quote.background = { color: THEME.teal };
    quote.addText("“", { x: 0.6, y: 0.2, w: 1.5, h: 1.8, fontFace: FONT, fontSize: 120, bold: true, color: THEME.white, margin: 0, transparency: 40 });
    quote.addText("We did not chase every opportunity this year. We chose the ones our customers asked for, and did them well.", {
        x: 1.4,
        y: 1.3,
        w: 7.4,
        h: 2.2,
        fontFace: FONT,
        fontSize: 26,
        italic: true,
        color: THEME.white,
        margin: 0,
        valign: "middle",
        lineSpacingMultiple: 1.1,
    });
    quote.addShape("rect", { x: 1.4, y: 3.8, w: 0.8, h: 0.05, fill: { color: THEME.amber } });
    quote.addText(
        [
            { text: "Morgan Placeholder", options: { bold: true, fontSize: 14, breakLine: true } },
            { text: `Chief executive, ${COMPANY} (fictional)`, options: { fontSize: 11 } },
        ],
        { x: 1.4, y: 3.95, w: 6, h: 0.7, fontFace: FONT, color: THEME.white, margin: 0, valign: "top" },
    );

    // 12. Two columns of text.
    const people = contentSlide(pres, "People and commitments", "Products and people");
    const column = { y: 1.3, w: 4.3, h: 3.7, fontFace: FONT, fontSize: 11, color: THEME.ink, margin: 0, valign: "top", paraSpaceAfter: 6 } as const;

    people.addText(
        [
            { text: "Our team", options: { bold: true, fontSize: 15, color: THEME.navy, breakLine: true } },
            { text: "Headcount grew from 1,480 to ", options: {} },
            { text: "1,612", options: { bold: true } },
            { text: " people across 9 offices.", options: { breakLine: true } },
            { text: "Engagement score: 78, up 4 points.", options: { bullet: true, breakLine: true } },
            { text: "Voluntary turnover fell to 8.9%.", options: { bullet: true, breakLine: true } },
            { text: "Every employee had ", options: { bullet: true } },
            { text: "five paid learning days", options: { italic: true } },
            { text: ".", options: { breakLine: true } },
            { text: "Leadership is 46% women, up from 41%.", options: { bullet: true } },
        ],
        { ...column, x: SLIDE.margin },
    );
    people.addShape("line", { x: 5.0, y: 1.35, w: 0, h: 3.5, line: { color: THEME.rule, width: 1 } });
    people.addText(
        [
            { text: "Our commitments", options: { bold: true, fontSize: 15, color: THEME.navy, breakLine: true } },
            { text: "Measured and published every year:", options: { breakLine: true } },
            { text: "Office energy from renewable contracts: ", options: { bullet: { type: "number" } } },
            { text: "92%", options: { bold: true, color: THEME.teal, breakLine: true } },
            { text: "Device take-back programme: ", options: { bullet: { type: "number" } } },
            { text: "14,200 units", options: { bold: true, color: THEME.teal, breakLine: true } },
            { text: "Volunteering hours: ", options: { bullet: { type: "number" } } },
            { text: "9,850", options: { bold: true, color: THEME.teal, breakLine: true } },
            { text: "Targets are set by the board and checked by an independent (fictional) reviewer.", options: { italic: true, color: THEME.grey, fontSize: 9.5 } },
        ],
        { ...column, x: 5.2 },
    );

    // 13. Outlook: a stacked column chart and the targets beside it.
    const outlook = contentSlide(pres, "Outlook for 2027", "Outlook");

    outlook.addChart(
        "bar",
        [
            { name: "Platform", labels: ["2024", "2025", "2026", "2027 plan"], values: [182, 208, 239, 276] },
            { name: "Services", labels: ["2024", "2025", "2026", "2027 plan"], values: [74, 82, 91, 98] },
            { name: "Hardware and training", labels: ["2024", "2025", "2026", "2027 plan"], values: [63, 71, 83, 91] },
        ],
        {
            ...chartText,
            x: SLIDE.margin,
            y: 1.3,
            w: 5.4,
            h: 3.8,
            barDir: "col",
            barGrouping: "stacked",
            barGapWidthPct: 70,
            chartColors: [THEME.navy, THEME.teal, THEME.amber],
            showLegend: true,
            legendPos: "b",
            showTitle: true,
            title: "Revenue by segment (USD millions)",
            valAxisMinVal: 0,
            valAxisMaxVal: 500,
            valAxisMajorUnit: 100,
            valGridLine: { color: THEME.rule, size: 0.5 },
        },
    );
    outlook.addText(
        [
            { text: "2027 targets", options: { bold: true, fontSize: 15, color: THEME.navy, breakLine: true } },
            { text: "Revenue of ", options: { bullet: true } },
            { text: "$460-470M", options: { bold: true } },
            { text: ".", options: { breakLine: true } },
            { text: "Operating margin above ", options: { bullet: true } },
            { text: "19%", options: { bold: true } },
            { text: ".", options: { breakLine: true } },
            { text: "Launch all five roadmap milestones.", options: { bullet: true, breakLine: true } },
            { text: "Keep renewals above 95%.", options: { bullet: true, breakLine: true } },
            { text: "Plans are illustrative; this company does not exist.", options: { italic: true, color: THEME.grey, fontSize: 9.5 } },
        ],
        { x: 6.3, y: 1.4, w: 3.2, h: 3.5, fontFace: FONT, fontSize: 11, color: THEME.ink, margin: 0, valign: "top", paraSpaceAfter: 6 },
    );

    // 14. Closing slide.
    const closing = pres.addSlide();

    closing.background = { color: THEME.navy };
    closing.addShape("ellipse", { x: -1.6, y: 2.4, w: 4.6, h: 4.6, fill: { color: THEME.teal, transparency: 70 } });
    closing.addImage({ data: logo, x: 4.5, y: 0.9, w: 1, h: 1 });
    closing.addText("Thank you", { x: SLIDE.margin, y: 2.1, w: CONTENT_W, h: 0.9, fontFace: FONT, fontSize: 40, bold: true, color: THEME.white, align: "center", margin: 0 });
    closing.addText(
        [
            { text: "Investor relations: ", options: { color: "B8C7D9" } },
            { text: "ir@quillfeather.example", options: { bold: true, color: THEME.white, breakLine: true } },
            { text: "Full accounts are published with this (fictional) report.", options: { color: "B8C7D9", italic: true } },
        ],
        { x: SLIDE.margin, y: 3.1, w: CONTENT_W, h: 0.8, fontFace: FONT, fontSize: 13, align: "center", margin: 0, valign: "top", paraSpaceAfter: 4 },
    );

    return pres;
}

if (import.meta.main) {
    const deck = buildCompanyReport(new pptxgen());
    const { html } = await deck.toHtml();

    await writeFile("company-report.html", html);
    console.log(`Wrote company-report.html and ${await deck.writeFile({ fileName: "company-report.pdf" })} (${deck.getModel().slides.length} slides)`);
}
