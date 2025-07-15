module.exports = {
    testEnvironment: 'node',
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/commands/**',
        '!**/node_modules/**',
        '!**/tests/**'
    ],
    testMatch: [
        '**/tests/**/*.test.js'
    ],
    setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
    testTimeout: 10000,
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    silent: true,
    verbose: false
};