import { expect, test } from "bun:test";
import { z } from "zod";
import { normalizeComponent } from "../src/components/normalize";
import { COMPONENT_DEFAULTS } from "../src/defaults";
import { PuppeteerGen } from "../src/PuppeterrGen";
import { PAGE_SIZES } from "../src/pageLayouts";

const input = { type: "example/metric", version: 1, props: { label: "Revenue", value: 42 } };
const options = { x: 1, y: 2, w: 3, h: 1 };

test("Zod infers HTML props, applies defaults and validates before changing the slide", () => {
    const p = new PuppeteerGen();
    p.registerComponent("schema/card", 1, {
        schema: z.object({ label: z.string().default("Total"), value: z.number() }),
        render: props => {
            const value: number = props.value;
            return `<strong>${props.label}:${value.toFixed(1)}</strong>`;
        },
    });
    const slide = p.addSlide();
    expect(() => slide.addComponent({ type: "schema/card", version: 1, props: { value: "invalid" } }, options)).toThrow();
    expect(slide.slideElm.children.length).toBe(0);
    const props = { value: 4 };
    slide.addComponent({ type: "schema/card", version: 1, props }, options);
    expect(slide.slideElm.textContent).toBe("Total:4.0");
    expect(props).toEqual({ value: 4 });
});

test("Zod transforms run once for each render and must produce JSON-compatible props", () => {
    const p = new PuppeteerGen();
    p.registerComponent("schema/transform", 1, {
        schema: z.object({ value: z.string().transform(value => Number(value) + 1) }),
        render: props => String(props.value),
    });
    const slide = p.addSlide();
    slide.addComponent({ type: "schema/transform", version: 1, props: { value: "4" } }, options);
    expect(slide.slideElm.textContent).toBe("5");
    p.registerComponent("schema/date", 1, {
        schema: z.object({ value: z.string().transform(() => new Date()) }),
        render: () => "never",
    });
    expect(() => slide.addComponent({ type: "schema/date", version: 1, props: { value: "today" } }, options)).toThrow("plain objects");
    expect(slide.slideElm.children.length).toBe(1);
});

test("normalizes inches and snapshots props without materializing renderer code", () => {
    const normalized = normalizeComponent(input, options, PAGE_SIZES.SCREEN_16X9.landscape, "Metric");
    expect(normalized.style.geometry).toEqual({ x: 96, y: 192, width: 288, height: 96 });
    normalized.input.props.value = 99;
    expect(input.props.value).toBe(42);
    expect(normalized.style.transform).toMatchObject({ rotation: 0, opacity: 1 });
});

test("registered HTML components render in insertion order, clip and remain chainable", () => {
    const p = new PuppeteerGen();
    expect(p.registerComponent(input.type, 1, { render: props => `<strong>${props.label}</strong>` })).toBe(p);
    const slide = p.addSlide();
    slide.addText("Before");
    expect(slide.addComponent(input, options)).toBe(slide);
    slide.addText("After");
    const element = slide.slideElm.children[1] as HTMLElement;
    expect(element.className).toBe("slide-element slide-component");
    expect(element.dataset.componentType).toBe(input.type);
    expect(element.dataset.componentVersion).toBe("1");
    expect(element.dataset.objectName).toBe("Component 0");
    expect(element.style.left).toBe("96px");
    expect(element.style.width).toBe("288px");
    expect(element.style.overflow).toBe(COMPONENT_DEFAULTS.overflow);
    expect(element.querySelector("strong")?.textContent).toBe("Revenue");
});

test("context supports DOM renderers, pixel bounds and safe text assignment", () => {
    const p = new PuppeteerGen();
    const original = p.page.createElement("span");
    p.registerComponent("text", 1, {
        render: (props, ctx) => {
            expect(ctx.document).toBe(p.page);
            expect([ctx.width, ctx.height]).toEqual([288, 96]);
            original.textContent = String(props.text);
            return original;
        },
    });
    const slide = p.addSlide();
    slide.addComponent({ type: "text", version: 1, props: { text: "<b>literal</b>" } }, { ...options, objectName: "custom" });
    expect(original.parentNode).toBeNull();
    expect(slide.slideElm.querySelector("span")?.textContent).toBe("<b>literal</b>");
    expect(slide.slideElm.querySelector("b")).toBeNull();
});

test("registry is per presentation, supports multiple exact versions and late registration", () => {
    const a = new PuppeteerGen();
    const b = new PuppeteerGen();
    const slide = a.addSlide();
    a.registerComponent(input.type, 1, { render: () => "v1" });
    a.registerComponent(input.type, 2, { render: () => "v2" });
    slide.addComponent({ ...input, version: 2 }, options);
    expect(slide.slideElm.textContent).toBe("v2");
    expect(() => a.registerComponent(input.type, 1, { render: () => "" })).toThrow("already registered");
    expect(() => b.addSlide().addComponent(input, options)).toThrow("Unknown component");
    expect(() => slide.addComponent({ ...input, version: 3 }, options)).toThrow("Unknown component");
});

test("validation and renderer failures leave no partial slide objects", () => {
    const p = new PuppeteerGen();
    p.registerComponent(input.type, 1, {
        validate: () => {
            throw new Error("Invalid metric");
        },
        render: () => "never",
    });
    const slide = p.addSlide();
    expect(() => slide.addComponent(input, options)).toThrow("Invalid metric");
    p.registerComponent("bad-result", 1, { render: (() => Promise.resolve("later")) as never });
    expect(() => slide.addComponent({ ...input, type: "bad-result" }, options)).toThrow("must return HTML");
    expect(slide.slideElm.children.length).toBe(0);
});

test("rejects nonserializable props, invalid identity and unsupported geometry", () => {
    const p = new PuppeteerGen();
    p.registerComponent(input.type, 1, { render: () => "" });
    const slide = p.addSlide();
    for (const props of [{ value: undefined }, { value: NaN }, { value: new Date() }, { value: () => 1 }]) {
        expect(() => slide.addComponent({ ...input, props } as never, options)).toThrow();
    }
    for (const bad of [
        { ...options, w: 0 },
        { ...options, x: Infinity },
        { ...options, rotate: 45 },
    ]) {
        expect(() => slide.addComponent(input, bad)).toThrow();
    }
    expect(() => p.registerComponent("", 1, { render: () => "" })).toThrow();
    expect(() => slide.addComponent({ ...input, version: 0 }, options)).toThrow();
});

test("HTML images enter the existing image-resolution pipeline", () => {
    const p = new PuppeteerGen();
    p.registerComponent("images", 1, { render: () => '<img src="./logo.png"><img src="https://example.com/logo.png">' });
    const slide = p.addSlide();
    slide.addComponent({ type: "images", version: 1, props: {} }, options);
    const images = slide.slideElm.querySelectorAll("img");
    expect(images[0]!.dataset.sourcePath).toBe("./logo.png");
    expect(images[1]!.dataset.sourceUrl).toBe("https://example.com/logo.png");
    expect(images[0]!.hasAttribute("src")).toBe(false);
});
