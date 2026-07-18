import packageJson from "../../package.json" with { type: "json" };

export function getOpenRouterHeaders(): Record<string, string> {
	return {
		"User-Agent": `ReActor/${packageJson.version}`,
		"HTTP-Referer": "https://reactor.norman.id.vn/",
		"X-OpenRouter-Title": "ReActor",
		"X-OpenRouter-Categories": "cli-agent",
		"X-OpenRouter-Cache": "true",
		"X-OpenRouter-Cache-TTL": "3600",
	};
}
