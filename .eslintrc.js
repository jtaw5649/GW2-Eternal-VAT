module.exports = [
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                console: "readonly",
                process: "readonly",
                Buffer: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                exports: "writable",
                module: "writable",
                require: "readonly",
                global: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                setImmediate: "readonly",
                clearImmediate: "readonly"
            }
        },
        rules: {
            "indent": ["error", 4],
            "linebreak-style": ["error", "unix"],
            "quotes": ["error", "single"],
            "semi": ["error", "always"],
            "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
        }
    },
    {
        files: ["tests/**/*.js"],
        languageOptions: {
            globals: {
                jest: "readonly",
                describe: "readonly",
                test: "readonly",
                expect: "readonly",
                beforeEach: "readonly",
                afterEach: "readonly",
                beforeAll: "readonly",
                afterAll: "readonly"
            }
        }
    }
];