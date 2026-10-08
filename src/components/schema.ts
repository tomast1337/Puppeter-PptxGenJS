import type { z } from "zod";
import { cloneComponentProps } from "./normalize";
import type { ComponentProps } from "./types";

/** Parse once for rendering, keeping wire input distinct from transformed/defaulted output. */
export function parseComponentProps<Props extends object>(schema: z.ZodType<Props>, props: ComponentProps): Props {
    return cloneComponentProps(schema.parse(props)) as Props;
}
