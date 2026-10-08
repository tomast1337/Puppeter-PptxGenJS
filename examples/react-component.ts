import { createElement } from "react";
import PuppeteerGen from "../src/exports";
import { registerReactComponent } from "../src/react";

function MetricCard({ label, value }: { label: string; value: number }) {
    return createElement(
        "div",
        {
            style: { height: "100%", padding: 16, boxSizing: "border-box", background: "#eef2ff", fontFamily: "Arial" },
        },
        createElement("strong", null, label),
        createElement("div", { style: { fontSize: 32 } }, value),
    );
}

const presentation = new PuppeteerGen();
registerReactComponent(presentation, "acme/metric", 1, MetricCard, {
    parseProps(props) {
        if (typeof props.label !== "string" || typeof props.value !== "number") throw new Error("Invalid metric props");
        return { label: props.label, value: props.value };
    },
});
presentation.addSlide().addComponent({ type: "acme/metric", version: 1, props: { label: "Revenue", value: 42 } }, { x: 1, y: 1, w: 3, h: 1.25 });
await presentation.writeFile({ fileName: "react-component.pdf" });
