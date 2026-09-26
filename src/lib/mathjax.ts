export const mathJaxConfig = {
  loader: { load: ["[tex]/boldsymbol"] },
  tex: {
    packages: { "[+]": ["boldsymbol"] },
    inlineMath: [["$", "$"], ["\\(", "\\)"]],
    displayMath: [["$$", "$$"], ["\\[", "\\]"]],
    processEscapes: true,
  },
  chtml: { mtextInheritFont: true, fontURL: "/mathjax/output/chtml/fonts/woff-v2" },
  options: { skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"] },
};
