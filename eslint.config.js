import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"

const nodeGlobals = { process: "readonly", console: "readonly", __dirname: "readonly" }

/* Flat config (AUDIT.md §9): typed rules need `parserOptions.project` to resolve a tsconfig
   for every linted file. The two projects (renderer vs. main/preload/shared/scripts) aren't
   linked by a root "references" config, so both are listed explicitly rather than relying on
   TypeScript's own project-service discovery to find them on its own. */
export default tseslint.config(
  {
    ignores: ["out/**", "node_modules/**", "resources/**", "pnpm-lock.yaml"],
  },

  js.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* narrow the recommended rule down to the actual footgun (an unused *value*) —
         unused type-only imports/params are routine in this codebase's interfaces */
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      /* an async handler passed as a JSX attribute (onClick/onChange/...), a callback property
         (e.g. the `Ctx` objects threaded through the refs tree), or a bare callback argument
         (onOp/onChanged event subscriptions, cf. lib/git.ts) is the standard idiom used
         throughout this codebase (fire-and-forget from the caller's perspective, the promise is
         a real IPC call to main) — the stricter default treats every one as a bug */
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false, properties: false, arguments: false } },
      ],
      /* flags `useXStore((s) => s.action)` selectors (zustand) as an "unbound method": these
         are plain closures captured by value, not object methods relying on `this` — the rule
         has no useful signal for this store pattern */
      "@typescript-eslint/unbound-method": "off",
      /* `cond ? doA() : doB()` as a statement (rather than if/else) is an established idiom in
         this codebase for compact conditional side effects — allow both branches of the ternary */
      "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true, allowShortCircuit: true }],
    },
  },

  /* React Compiler-oriented rules (static-components, use-memo, purity, set-state-in-render,
     gating, etc.) assume a codebase opted into the Compiler, which this one isn't — scoped down
     to the two rules everyone means by "eslint-plugin-react-hooks": rules-of-hooks and
     exhaustive-deps. */
  {
    files: ["src/renderer/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  /* components/ui/* is the only surface allowed to reach into primitives/* directly
     (AUDIT.md §7/§9) — everywhere else must go through the ui/ re-export layer. */
  {
    files: ["src/renderer/src/**/*.{ts,tsx}"],
    ignores: ["src/renderer/src/components/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/ui/primitives/*", "@/components/ui/primitives"],
              message: 'Import from "@/components/ui/*" instead of reaching into primitives/ directly.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module", globals: nodeGlobals },
  }
)
