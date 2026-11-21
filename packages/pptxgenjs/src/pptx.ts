import type PptxGenJS from "pptxgenjs";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- a class implements this contract
export interface PptxGenJSLike extends PptxGenJS {}
export type PptxSlide = PptxGenJS.Slide;
export type PptxTableRow = PptxGenJS.TableRow;
export type PptxTableProps = PptxGenJS.TableProps;
export type PptxTextProps = PptxGenJS.TextProps;
export type PptxTextPropsOptions = PptxGenJS.TextPropsOptions;
export type PptxShapeProps = PptxGenJS.ShapeProps;
export type PptxWriteBaseProps = PptxGenJS.WriteBaseProps;
export type PptxWriteProps = PptxGenJS.WriteProps;
export type PptxWriteFileProps = PptxGenJS.WriteFileProps;
export type PptxSectionProps = PptxGenJS.SectionProps;
export type PptxAddSlideProps = PptxGenJS.AddSlideProps;
export type PptxSlideMasterProps = PptxGenJS.SlideMasterProps;
export type PptxTableToSlidesProps = PptxGenJS.TableToSlidesProps;
