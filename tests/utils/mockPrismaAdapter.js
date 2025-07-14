const createMockPrismaAdapter = () => {
    const mockAdapter = {
        provider: 'postgres',
        adapterName: 'mock-pg', 
        name: 'mock-pg',
        driverAdapter: {
            provider: 'postgres'
        },
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        queryRaw: jest.fn().mockResolvedValue([]),
        executeRaw: jest.fn().mockResolvedValue({ rowsAffected: 0 }),
        transactionContext: jest.fn().mockImplementation(async (fn) => {
            return await fn({
                provider: 'postgres',
                queryRaw: jest.fn().mockResolvedValue([]),
                executeRaw: jest.fn().mockResolvedValue({ rowsAffected: 0 })
            });
        }),
        startTransaction: jest.fn().mockResolvedValue({
            id: 'mock-transaction-id',
            provider: 'postgres',
            queryRaw: jest.fn().mockResolvedValue([]),
            executeRaw: jest.fn().mockResolvedValue({ rowsAffected: 0 }),
            commit: jest.fn().mockResolvedValue(undefined),
            rollback: jest.fn().mockResolvedValue(undefined)
        })
    };
    
    Object.defineProperty(mockAdapter, 'provider', {
        get: () => 'postgres',
        enumerable: true
    });
    
    return mockAdapter;
};

module.exports = { createMockPrismaAdapter };