import { expect, test } from "bun:test";
import { Component, createElement, useEffect, useId } from "react";
import { z } from "zod";
import { PuppeteerGen } from "../src/PuppeterrGen";
import { registerReactComponent } from "../src/react";

interface MetricProps {
    label: string;
    value: number;
}
function Metric({ label, value }: MetricProps) {
    return createElement(
        "section",
        { style: { padding: 16, background: "#eef2ff" } },
        createElement("strong", null, label),
        createElement("span", null, value),
    );
}
const geometry = { x: 1, y: 2, w: 3, h: 1 };

test("React uses the shared Zod props schema for defaults and validation", () => {
    const schema = z.object({ label: z.string().default("Revenue"), value: z.number() });
    const p = new PuppeteerGen();
    registerReactComponent(p, "schema/metric", 1, Metric, { schema });
    const slide = p.addSlide();
    expect(() => slide.addComponent({ type: "schema/metric", version: 1, props: { value: "bad" } }, geometry)).toThrow();
    expect(slide.slideElm.children.length).toBe(0);
    slide.addComponent({ type: "schema/metric", version: 1, props: { value: 42 } }, geometry);
    expect(slide.slideElm.querySelector("strong")?.textContent).toBe("Revenue");
    // @ts-expect-error Schema output must match the React component's props.
    registerReactComponent(p, "invalid", 1, Metric, { schema: z.object({ label: z.string(), value: z.string() }) });
});

test("React adapter renders typed function components through the HTML registry", () => {
    const presentation = new PuppeteerGen();
    expect(registerReactComponent(presentation, "metric", 1, Metric)).toBe(presentation);
    const slide = presentation.addSlide();
    slide.addComponent({ type: "metric", version: 1, props: { label: "<Revenue>", value: 42 } }, geometry);
    expect(slide.slideElm.querySelector("strong")?.textContent).toBe("<Revenue>");
    expect(slide.slideElm.querySelector("revenue")).toBeNull();
    expect(slide.slideElm.querySelector("span")?.textContent).toBe("42");
    expect((slide.slideElm.querySelector("section") as HTMLElement).style.padding).toBe("16px");
    expect((slide.slideElm.firstElementChild as HTMLElement).style.width).toBe("288px");
});

test("prop parsing validates saved data before rendering", () => {
    const presentation = new PuppeteerGen();
    registerReactComponent(presentation, "metric", 1, Metric, {
        parseProps(props) {
            if (typeof props.label !== "string" || typeof props.value !== "number") throw new Error("Invalid metric props");
            return { label: props.label, value: props.value };
        },
    });
    const slide = presentation.addSlide();
    expect(() => slide.addComponent({ type: "metric", version: 1, props: { label: "Revenue", value: "bad" } }, geometry)).toThrow("Invalid metric props");
    expect(slide.slideElm.children.length).toBe(0);
    slide.addComponent({ type: "metric", version: 1, props: { label: "Revenue", value: 42 } }, geometry);
    expect(slide.slideElm.textContent).toBe("Revenue42");
});

test("useId stays unique across component types and slides, and deterministic across presentations", () => {
    function Label() {
        const id = useId();
        return createElement("div", null, createElement("label", { htmlFor: id }, "Value"), createElement("input", { id, readOnly: true, value: "42" }));
    }
    function render() {
        const p = new PuppeteerGen();
        registerReactComponent(p, "label", 1, Label);
        registerReactComponent(p, "other-label", 1, Label);
        const first = p.addSlide();
        first.addComponent({ type: "label", version: 1, props: {} }, geometry);
        first.addComponent({ type: "other-label", version: 1, props: {} }, geometry);
        p.addSlide().addComponent({ type: "label", version: 1, props: {} }, geometry);
        const ids = Array.from(p.page.querySelectorAll("input"), element => element.id);
        expect(Array.from(p.page.querySelectorAll("label"), element => element.htmlFor)).toEqual(ids);
        return ids;
    }
    const ids = render();
    expect(new Set(ids).size).toBe(3);
    expect(render()).toEqual(ids);
});

test("class components work and client effects do not run during static export", () => {
    class ClassMetric extends Component<MetricProps> {
        override render() {
            return createElement(Metric, this.props);
        }
    }
    let effects = 0;
    function WithEffect() {
        useEffect(() => {
            effects++;
        }, []);
        return createElement(ClassMetric, { label: "Total", value: 7 });
    }
    const p = new PuppeteerGen();
    registerReactComponent(p, "class", 1, WithEffect);
    p.addSlide().addComponent({ type: "class", version: 1, props: {} }, geometry);
    expect(p.page.querySelector("section")?.textContent).toBe("Total7");
    expect(effects).toBe(0);
});

test("renderer exceptions and duplicate registrations remain explicit", () => {
    function Broken(): never {
        throw new Error("React render failed");
    }
    const p = new PuppeteerGen();
    registerReactComponent(p, "broken", 1, Broken);
    expect(() => registerReactComponent(p, "broken", 1, Metric)).toThrow("already registered");
    const slide = p.addSlide();
    expect(() => slide.addComponent({ type: "broken", version: 1, props: {} }, geometry)).toThrow("React render failed");
    expect(slide.slideElm.children.length).toBe(0);
});

test("prop parser return types are checked against the React component", () => {
    const p = new PuppeteerGen();
    registerReactComponent(p, "typecheck", 1, Metric, {
        // @ts-expect-error Metric requires a numeric value; options cannot widen its inferred props.
        parseProps: () => ({ label: "Revenue", value: "not a number" }),
    });
});
