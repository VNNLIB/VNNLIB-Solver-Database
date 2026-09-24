#!/usr/bin/env node
/*
 * Compile Tailwind to css/tailwind.css, so the site can be served without the
 * Play CDN.
 *
 *     node build.js
 *
 * The problem this exists to solve: the component classes (.card, .badge,
 * .field and friends) are declared in `<style type="text/tailwindcss">` blocks
 * in the HTML. That is how the Play CDN is given `@apply` rules, and only the
 * CDN understands that script type. The CLI cannot see them.
 *
 * Rather than keep a second copy in a .css file, where the two would drift apart
 * the first time anyone edited one, this lifts the blocks out of the pages and
 * feeds them to the CLI. The HTML stays the single source.
 *
 * Every page is scanned, not just index.html, because a page may declare
 * components only it uses: solvers.html has the pagination buttons, index.html
 * has the carousel arrows. Taking one page's block would silently leave the
 * other page's components out of the compiled stylesheet, which shows up as a
 * few unstyled controls on one page only, in the compiled build and not under
 * the CDN. That is a bad bug to go looking for.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = __dirname;
const OUT = path.join(ROOT, "css", "tailwind.css");

const pages = fs
    .readdirSync(ROOT)
    .filter(function (name) {
        return name.endsWith(".html");
    })
    .sort();

/*
 * Selector to its full rule text, in the order first seen. A component declared
 * identically on two pages is kept once; one declared differently on two pages
 * is a mistake worth stopping for, since whichever won would depend on file
 * order.
 */
const rules = new Map();
const sources = new Map();

pages.forEach(function (page) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const blocks = html.match(
        /<style type="text\/tailwindcss">([\s\S]*?)<\/style>/g
    );
    if (!blocks) {
        return;
    }

    blocks.forEach(function (block) {
        const body = block
            .replace(/^<style type="text\/tailwindcss">/, "")
            .replace(/<\/style>$/, "");

        // Inside `@layer components { ... }`, each rule is `selector { ... }`
        // with no nesting, so a non-greedy match per rule is enough. Anything
        // more would mean parsing CSS, which is not this script's job.
        const layer = body.match(/@layer\s+components\s*\{([\s\S]*)\}/);
        const scope = layer ? layer[1] : body;

        const pattern = /([^{}]+)\{([^{}]*)\}/g;
        let match;
        while ((match = pattern.exec(scope)) !== null) {
            const selector = match[1].trim();
            const text = selector + " {" + match[2].replace(/\s+$/, "") + "\n}";
            if (!selector) {
                continue;
            }
            if (rules.has(selector)) {
                if (rules.get(selector) !== text) {
                    console.error(
                        `\n${selector} is declared differently in ${sources.get(selector)} ` +
                        `and ${page}.\nThe compiled stylesheet can only hold one, and which ` +
                        `one would depend on\nfile order. Make them identical, or give one a ` +
                        `different name.`
                    );
                    process.exit(1);
                }
                continue;
            }
            rules.set(selector, text);
            sources.set(selector, page);
        }
    });
});

if (!rules.size) {
    console.error(
        'No <style type="text/tailwindcss"> rules found in any page.\n' +
        "If the component classes were moved into a stylesheet of their own,\n" +
        "point this script at that file instead."
    );
    process.exit(1);
}

const input = [
    "@tailwind base;",
    "@tailwind components;",
    "@tailwind utilities;",
    "",
    "/* Lifted from the HTML by build.js. Edit it there, not here. */",
    "@layer components {",
    Array.from(rules.values())
        .map(function (rule) {
            return rule
                .split("\n")
                .map(function (line) {
                    return line ? "    " + line.trim() : line;
                })
                .join("\n");
        })
        .join("\n"),
    "}",
    "",
].join("\n");

const tmp = path.join(os.tmpdir(), "vnnlib-tailwind-input.css");
fs.writeFileSync(tmp, input, "utf8");

console.log(`Components from: ${pages.join(", ")}`);
console.log(`Rules: ${rules.size}`);
console.log("Compiling Tailwind...");

execFileSync(
    "npx",
    [
        "--yes",
        "tailwindcss@3.4.16",
        "-c", path.join(ROOT, "tailwind.config.js"),
        "-i", tmp,
        "-o", OUT,
        "--minify",
    ],
    { stdio: "inherit", cwd: ROOT }
);
fs.unlinkSync(tmp);

const size = fs.statSync(OUT).size;
console.log(`\nWrote css/tailwind.css (${(size / 1024).toFixed(1)} KB).`);
console.log(
    "\nTo use it, in every page replace:\n" +
    '    <script src="https://cdn.tailwindcss.com/3.4.16"></script>\n' +
    '    <script src="tailwind.config.js"></script>\n' +
    "with:\n" +
    '    <link rel="stylesheet" href="css/tailwind.css">\n' +
    'and delete the <style type="text/tailwindcss"> block, which the compiled\n' +
    "file now contains."
);
