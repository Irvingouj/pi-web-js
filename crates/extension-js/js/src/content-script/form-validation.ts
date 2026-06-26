/**
 * Invalid form-control inspection for the `submit` handler.
 *
 * Collects controls that fail native constraint validation or carry
 * aria-invalid, excluding hidden react-select validation-shim inputs.
 */
import {
	getAccessibleName,
	getAccessibleRole,
	isValidationProxyInput,
	readErrorMessage,
} from "../shared/snapshot-dom.js";

export type InvalidFormControl = {
	refId: string | undefined;
	tag: string;
	role: string;
	name: string | undefined;
	field: string | undefined;
	error: string;
	value: string | undefined;
	required: boolean;
	validationMessage: string | undefined;
};

export function invalidFormControls(
	form: HTMLFormElement,
): InvalidFormControl[] {
	return Array.from(
		form.querySelectorAll<
			HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
		>("input, textarea, select"),
	)
		.filter(
			(el) =>
				(!el.checkValidity() || el.getAttribute("aria-invalid") === "true") &&
				!isValidationProxyInput(el),
		)
		.map((el) => {
			const name = getAccessibleName(el) || undefined;
			const field = resolveFieldLabel(el, name);
			const error = readErrorMessage(el) || el.validationMessage || "";
			return {
				refId: el.getAttribute("data-ref-id") || undefined,
				tag: el.tagName.toLowerCase(),
				role: getAccessibleRole(el),
				name,
				field,
				error,
				value:
					el instanceof HTMLInputElement && el.type === "password"
						? undefined
						: el.value,
				required: el.required || el.getAttribute("aria-required") === "true",
				validationMessage: el.validationMessage || undefined,
			};
		});
}

/**
 * Resolve a human-readable field label for an invalid control.
 *
 * Tries, in order: accessible name → label[for=id] → wrapping <label> →
 * preceding sibling <label> → parent's first <label> child → refId.
 */
function resolveFieldLabel(
	el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	name: string | undefined,
): string | undefined {
	if (name) return name;
	const id = el.getAttribute("id");
	if (id) {
		const safeId =
			typeof CSS !== "undefined" && CSS.escape
				? CSS.escape(id)
				: id.replace(/["\\]/g, "\\$&");
		const label = document.querySelector(`label[for="${safeId}"]`);
		if (label?.textContent?.trim()) return label.textContent.trim();
	}
	const wrappingLabel = el.closest("label");
	if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();
	const prev = el.previousElementSibling;
	if (prev?.tagName === "LABEL" && prev.textContent?.trim())
		return prev.textContent.trim();
	const parent = el.parentElement;
	if (parent) {
		const parentLabel = parent.querySelector("label");
		if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
	}
	return el.getAttribute("data-ref-id") || undefined;
}
