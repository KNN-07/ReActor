import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceRecord } from "./types";

export interface SurveyValidationResult {
	errors: string[];
	warnings: string[];
}

export function validateSurveyArtifacts(
	root: string,
	sources: SourceRecord[],
	bibtex: string,
	latex: string,
): SurveyValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const keys = sources.map(source => source.citationKey);
	if (new Set(keys).size !== keys.length) errors.push("Duplicate citation keys in sources.json");
	const bibKeys = [...bibtex.matchAll(/@\w+\s*\{\s*([^,\s]+)/g)].map(match => match[1]);
	if (new Set(bibKeys).size !== bibKeys.length) errors.push("Duplicate BibTeX keys");
	for (const key of bibKeys) if (!keys.includes(key)) errors.push(`BibTeX key is absent from sources.json: ${key}`);
	for (const key of [...latex.matchAll(/\\cite\{([^}]+)\}/g)].flatMap(match =>
		match[1].split(",").map(item => item.trim()),
	)) {
		if (!bibKeys.includes(key)) errors.push(`Missing BibTeX citation key: ${key}`);
	}
	for (const source of sources)
		if (!source.verified && bibKeys.includes(source.citationKey))
			errors.push(`Unverified source leaked into BibTeX: ${source.citationKey}`);
	for (const required of ["sources.json", "references.bib", "main.tex", "SUMMARY.md"])
		if (!fs.existsSync(path.join(root, required))) errors.push(`Missing required artifact: ${required}`);
	return { errors, warnings };
}

export function verifiedBibtex(sources: SourceRecord[]): string {
	return sources
		.filter(source => source.verified)
		.map(
			source =>
				`@article{${source.citationKey},\n  title={${source.title}},\n  author={${source.authors.join(" and ")}},\n  year={${source.year}},\n  url={${source.canonicalUrl}}\n}`,
		)
		.join("\n\n");
}
