import type { FunctionalComponent } from "preact";
import type { KernelStatus } from "../hooks/useKernel";

interface Props {
	kernelStatus: KernelStatus;
	theme: "light" | "dark";
	onToggleTheme: () => void;
}

const statusLabels: Record<KernelStatus, string> = {
	ready: "ready",
	running: "running",
	stopped: "stopped",
	error: "error",
};

const TopBar: FunctionalComponent<Props> = ({
	kernelStatus,
	theme,
	onToggleTheme,
}) => {
	return (
		<header class="topbar">
			<div class="topbar-left">
				<span class="logo">⚡</span>
				<h1 class="topbar-title">JS Notebook</h1>
			</div>
			<div class="topbar-right">
				<button
					type="button"
					class="btn-icon"
					title="Toggle dark mode"
					onClick={onToggleTheme}
				>
					{theme === "dark" ? "☀️" : "🌓"}
				</button>
				<span
					data-testid="kernel-status"
					class={`kernel-badge kernel-${kernelStatus}`}
				>
					Kernel: {statusLabels[kernelStatus]}
				</span>
			</div>
		</header>
	);
};

export default TopBar;
