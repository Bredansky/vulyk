import { RuleSeverity, styleguide } from "zirka";

const { eslintConfig } = styleguide({
  node: RuleSeverity.Error,
  typescript: RuleSeverity.Error,
  ignores: ["dist/**", "node_modules/**"],
  additionalConfigs: [
    {
      files: ["eslint.config.ts"],
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: ["eslint.config.ts"],
          },
        },
      },
    },
  ],
});

export default eslintConfig;
