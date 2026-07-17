import { countTokens as countTokensNat } from "@reactor/natives";

const accurate = process.env.REACTOR_TOKENIZER_ACCURATE === "1" && Bun.env.NODE_ENV !== "test";

function estimateTokens(text: string) {
	return (Buffer.byteLength(text, "utf-8") + 3) >> 2;
}

export function countTokens(text: string | string[]): number {
	if (accurate) {
		return countTokensNat(text);
	} else if (Array.isArray(text)) {
		return text.reduce((sum, t) => sum + estimateTokens(t), 0);
	} else {
		return estimateTokens(text);
	}
}
