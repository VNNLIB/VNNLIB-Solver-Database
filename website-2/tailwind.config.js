/*
 * One source of truth for the site's design tokens.
 *
 * The same file serves both ways of loading Tailwind, which is why it guards
 * its exports:
 *
 *   Play CDN   index.html loads this straight after cdn.tailwindcss.com, and
 *              the `window` branch hands the config over.
 *   Tailwind CLI  `npx tailwindcss -c tailwind.config.js ...` requires it as a
 *              CommonJS module, where `window` does not exist and the
 *              `module.exports` branch runs instead.
 *
 * Switching from one to the other therefore changes no markup and no colours.
 * See README.md.
 */

const config = {
  // Which files Tailwind scans for class names. Only used by the CLI: the Play
  // CDN watches the live DOM instead.
  content: ["./*.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        // The two brand colours. `ink` is the navy behind the masthead
        // gradient and the footer; `brand` is the blue used for links, accents
        // and anything interactive.
        ink: {
          DEFAULT: "#020024",
          soft: "#0b0a3d",
          muted: "#3f3f6b",
        },
        brand: {
          DEFAULT: "#008ae6",
          dark: "#0071bd",
          light: "#e6f4ff",
          // Opaque rather than a translucent brand, so it composites the same
          // over white whatever is behind it.
          tint: "#f2f9ff",
        },
        // The code box: navy background, near-white text, green inline code.
        code: {
          bg: "#020024",
          text: "#e6f4ea",
          inline: "#009900",
        },
      },
      fontFamily: {
        // Defined by css/heading.css and css/body.css, which are the
        // Montserrat and Lato subsets the site ships.
        heading: ['"SB Heading"', "Montserrat", "system-ui", "sans-serif"],
        body: ['"SB Body"', "Lato", "system-ui", "sans-serif"],
        mono: [
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          '"Liberation Mono"',
          '"Courier New"',
          "monospace",
        ],
      },
      maxWidth: {
        prose: "70ch",
      },
      boxShadow: {
        card: "0 1px 2px rgba(2,0,36,0.06), 0 8px 24px -12px rgba(2,0,36,0.18)",
      },
      backgroundImage: {
        /*
         * The masthead gradient.
         *
         * Dark the whole way down: near black at the top, a deep blue rather
         * than a bright one at the bottom. A field of coloured neurons is drawn
         * over it, and a bright band across the header would sit exactly where
         * the lightest of them need contrast.
         */
        masthead: "linear-gradient(180deg, #01010e 0%, #020024 45%, #052a52 100%)",
      },
    },
  },
};

// Play CDN: it reads `tailwind.config` off the global after its own script has
// run, so this file must be loaded second.
if (typeof window !== "undefined") {
  window.tailwind = window.tailwind || {};
  window.tailwind.config = config;
}

// Tailwind CLI: plain CommonJS require.
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = config;
}
