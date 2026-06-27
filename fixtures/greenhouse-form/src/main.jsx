import React, { useState } from "react";
import Select from "react-select";
import { createRoot } from "react-dom/client";

// Mimics the Greenhouse job-application form shape that broke the agent:
// - Country select whose option labels carry a "+dialcode" suffix
//   (agent asks for "Canada", option text is "Canada +1").
// - Location select whose options render asynchronously (large virtualized
//   list) — the listbox shell mounts before its [role=option] children.
// - Degree / Yes-No selects sharing the page so sibling listbox portals
//   coexist.
const COUNTRIES = [
	{ value: "US", label: "United States +1" },
	{ value: "CA", label: "Canada +1" },
	{ value: "AF", label: "Afghanistan +93" },
	{ value: "AL", label: "Albania +355" },
];

// Large list — react-select virtualizes / delays option paint.
const LOCATIONS = Array.from({ length: 50 }, (_, i) => ({
	value: `loc-${i}`,
	label: [
		"Ottawa, Ontario, Canada",
		"Toronto, Ontario, Canada",
		"Vancouver, British Columbia, Canada",
		"Montreal, Quebec, Canada",
		"Calgary, Alberta, Canada",
	][i % 5],
}));

const DEGREES = [
	{ value: "bachelor", label: "Bachelor's Degree" },
	{ value: "master", label: "Master's Degree" },
	{ value: "phd", label: "PhD" },
];

const YESNO = [
	{ value: "yes", label: "Yes" },
	{ value: "no", label: "No" },
];

function Field({ label, children }) {
	return (
		<div style={{ marginBottom: 16 }}>
			<label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
				{label}
			</label>
			{children}
		</div>
	);
}

export default function App() {
	const [country, setCountry] = useState(null);
	const [location, setLocation] = useState(null);
	const [degree, setDegree] = useState(null);
	const [startup, setStartup] = useState(null);
	const [submitted, setSubmitted] = useState(null);

	const onSubmit = (e) => {
		e.preventDefault();
		setSubmitted({ country, location, degree, startup });
	};

	return (
		<form
			onSubmit={onSubmit}
			style={{ maxWidth: 560, margin: "40px auto", fontFamily: "sans-serif" }}
		>
			<h1>Job Application (Greenhouse fixture)</h1>
			<Field label="First Name">
				<input id="first_name" type="text" />
			</Field>
			<Field label="Last Name">
				<input id="last_name" type="text" />
			</Field>
			<Field label="Country*">
				<Select
					inputId="country"
					value={country}
					onChange={setCountry}
					options={COUNTRIES}
					placeholder="Select country"
				/>
			</Field>
			<Field label="Location (City)*">
				<Select
					inputId="candidate-location"
					value={location}
					onChange={setLocation}
					options={LOCATIONS}
					placeholder="Select city"
				/>
			</Field>
			<Field label="Degree">
				<Select
					inputId="degree"
					value={degree}
					onChange={setDegree}
					options={DEGREES}
					placeholder="Select degree"
				/>
			</Field>
			<Field label="Do you have startup experience?">
				<Select
					inputId="question_startup"
					value={startup}
					onChange={setStartup}
					options={YESNO}
					placeholder="Yes / No"
				/>
			</Field>
			<button type="submit">Submit application</button>
			{submitted && (
				<pre
					style={{
						marginTop: 24,
						padding: 16,
						background: "#f4f4f4",
						borderRadius: 6,
					}}
				>
					{JSON.stringify(submitted, null, 2)}
				</pre>
			)}
		</form>
	);
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
