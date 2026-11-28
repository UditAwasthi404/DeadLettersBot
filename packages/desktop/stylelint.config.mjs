export default {
  rules: { "color-no-hex": true, "color-named": "never" },
  overrides: [{ files: ["src/design/*tokens.css"], rules: { "color-no-hex": null, "color-named": null } }],
};
