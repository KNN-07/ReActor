import sharp from "sharp";

const root = new URL("..", import.meta.url).pathname;
const outputs = [
	["assets/hero.svg", "assets/hero.png", 1500, 500, "png"],
	["assets/reactor-mark.svg", "packages/collab-web/public/favicon.png", 512, 512, "png"],
	["assets/reactor-mark.svg", "packages/collab-web/public/favicon-512x512.png", 512, 512, "png"],
	["assets/reactor-mark.svg", "packages/collab-web/public/favicon-192x192.png", 192, 192, "png"],
	["assets/reactor-mark.svg", "packages/collab-web/public/favicon-180x180.png", 180, 180, "png"],
	["assets/reactor-mark.svg", "packages/collab-web/public/favicon-32x32.png", 32, 32, "png"],
	["assets/reactor-mark.svg", "packages/collab-web/public/favicon-16x16.png", 16, 16, "png"],
	["assets/brand-board.svg", "assets/brand-board.png", 1600, 1000, "png"],
	["assets/brand-board.svg", "packages/collab-web/public/og-image.png", 1200, 630, "png"],
	["assets/reactor-mark.svg", "python/reactor-worker/assets/icon.png", 512, 512, "png"],
	["assets/reactor-mark.svg", "python/reactor-worker/assets/icon.jpg", 512, 512, "jpeg"],
];

for (const [input, output, width, height, format] of outputs) {
	const source = await Bun.file(`${root}${input}`).text();
	let image = sharp(Buffer.from(source)).resize(width, height, { fit: "contain" });
	if (format === "jpeg") image = image.jpeg({ quality: 94 });
	else image = image.png();
	await Bun.write(`${root}${output}`, await image.toBuffer());
}

console.log(`Generated ${outputs.length} ReActor brand assets.`);
