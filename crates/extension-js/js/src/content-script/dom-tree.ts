/**
 * Raw DOM tree introspection for the `dom` handler.
 *
 * Thin adapter over the shared DOM pipeline (`shared/cs/dom-pipeline`),
 * which owns traversal, enrichment, and base node construction. This module
 * preserves the nested `children` shape that `page.dom` returns and re-exports
 * the `DomNode` type alias for backward compatibility.
 */

import type { PipelineNode } from "../shared/cs/dom-pipeline.js";
import { buildDomTree } from "../shared/cs/dom-pipeline.js";

export type DomNode = PipelineNode;

export function buildDomNode(
	el: Element,
	depth: number,
	includeHidden: boolean,
	observed?: Array<{ refId: string; element: Element }>,
): DomNode | null {
	return buildDomTree(el, depth, includeHidden, observed);
}
