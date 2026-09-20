import type PptxGenJS from "pptxgenjs";

export type ChartExtensionInput =
    | {
        renderer: "echarts";
        option: Readonly<Record<string, unknown>>;
    }
    | {
        renderer: "svg";
        svg: string;
    };

export type ChartExtensionOptions = PptxGenJS.PositionProps & {
    objectName?: string;
    altText?: string;
};
