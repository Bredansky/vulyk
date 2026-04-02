import { RuleSeverity, styleguide } from "zirka";

const { eslintConfig } = styleguide({
  node: RuleSeverity.Error,
  typescript: RuleSeverity.Error,
  ignores: ["dist/**", "node_modules/**"],
});

export default eslintConfig;
