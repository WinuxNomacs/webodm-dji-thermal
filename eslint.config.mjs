// ESLint for the plugin's front end: `npm run lint` at the repo root, or the VSCode ESLint extension
import js from "@eslint/js";
import globals from "globals";

export default [
    {ignores: ["**/node_modules/", "**/build/", "**/dist/", "ignored/", "dji-thermal/public/webpack.config.js"]},
    {
        // The plugin's pages: plain ES5 scripts, loaded by <script> tags and by Jest (UMD), with WebODM's React
        files: ["dji-thermal/public/*.js"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 5,
            sourceType: "script",
            // ES5 syntax, but the ES2015 Promise and typed arrays the browsers have; module and require are the UMD
            // wrapper's
            globals: {...globals.browser, Promise: "readonly", DataView: "readonly", Uint8Array: "readonly", Float32Array: "readonly",
                      Float64Array: "readonly", module: "readonly", require: "readonly", PluginsAPI: "readonly",
                      React: "readonly"},
        },
        // ES5 has no catch without a binding, so one left unused is no mistake
        rules: {...js.configs.recommended.rules, "no-unused-vars": ["error", {caughtErrors: "none"}]},
    },
    {
        // The thermal task's modules and components: built by WebODM's webpack and Babel (ES modules, JSX, class
        // fields), with React, ReactDOM and jQuery from WebODM's page
        files: ["dji-thermal/public/thermal/**/*.{js,jsx}"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {ecmaFeatures: {jsx: true}},
            globals: {...globals.browser},
        },
    },
    {
        // Jest's tests, ES modules through babel-jest (Babel's settings are in package.json)
        files: ["dji-thermal/public/__tests__/**/*.js"],
        ...js.configs.recommended,
        languageOptions: {ecmaVersion: 2022, sourceType: "module", globals: {...globals.browser, ...globals.node, ...globals.jest}},
    },
    {
        files: ["dev/**/*.js"],
        ...js.configs.recommended,
        languageOptions: {ecmaVersion: 2022, sourceType: "commonjs", globals: {...globals.browser, ...globals.node, ...globals.jest}},
    },
];
