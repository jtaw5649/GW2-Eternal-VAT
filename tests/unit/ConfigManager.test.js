const { PrismaClient } = require('@prisma/client');
const { ConfigManager } = require('../../src/bot');

describe('ConfigManager', () => {
    let prisma;
    let redis;
    let configManager;
    
    beforeEach(() => {
        prisma = {
            serverConfig: {
                findUnique: jest.fn(),
                create: jest.fn(),
                update: jest.fn()
            }
        };
        redis = {
            get: jest.fn(),
            setex: jest.fn(),
            del: jest.fn()
        };
        configManager = new ConfigManager(prisma, redis);
    });
    
    afterEach(() => {
        jest.clearAllMocks();
    });
    
    describe('getServerConfig', () => {
        const guildId = '1234567890';
        const mockConfig = {
            guildId,
            trackingRoleName: 'Voice Active',
            commandRoleId: null,
            reportChannelId: null,
            reportRecipients: [],
            minSessionMinutes: 20,
            rejoinWindowMinutes: 20,
            weeklyReportEnabled: true,
            weeklyReportDay: 0,
            weeklyReportHour: 9
        };
        
        test('returns config from memory cache if available', async () => {
            configManager.cache.set(guildId, {
                config: mockConfig,
                timestamp: Date.now()
            });
            
            const result = await configManager.getServerConfig(guildId);
            
            expect(result).toEqual(mockConfig);
            expect(redis.get).not.toHaveBeenCalled();
            expect(prisma.serverConfig.findUnique).not.toHaveBeenCalled();
        });
        
        test('returns config from Redis cache if not in memory', async () => {
            redis.get.mockResolvedValue(JSON.stringify(mockConfig));
            
            const result = await configManager.getServerConfig(guildId);
            
            expect(result).toEqual(mockConfig);
            expect(prisma.serverConfig.findUnique).not.toHaveBeenCalled();
            expect(configManager.cache.has(guildId)).toBe(true);
        });
        
        test('fetches from database if not cached', async () => {
            redis.get.mockResolvedValue(null);
            prisma.serverConfig.findUnique.mockResolvedValue(mockConfig);
            
            const result = await configManager.getServerConfig(guildId);
            
            expect(result).toEqual(mockConfig);
            expect(prisma.serverConfig.findUnique).toHaveBeenCalledWith({
                where: { guildId }
            });
            expect(configManager.cache.has(guildId)).toBe(true);
        });
        
        test('returns null if config not found', async () => {
            redis.get.mockResolvedValue(null);
            prisma.serverConfig.findUnique.mockResolvedValue(null);
            
            const result = await configManager.getServerConfig(guildId);
            
            expect(result).toBeNull();
        });
        
        test('respects cache timeout', async () => {
            configManager.cache.set(guildId, {
                config: mockConfig,
                timestamp: Date.now() - (6 * 60 * 1000) // 6 minutes ago
            });
            
            redis.get.mockResolvedValue(null);
            prisma.serverConfig.findUnique.mockResolvedValue(mockConfig);
            
            await configManager.getServerConfig(guildId);
            
            expect(prisma.serverConfig.findUnique).toHaveBeenCalled();
        });
    });
    
    describe('refreshCache', () => {
        const guildId = '1234567890';
        const mockConfig = { guildId, trackingRoleName: 'Updated Role' };
        
        test('updates all cache layers', async () => {
            prisma.serverConfig.findUnique.mockResolvedValue(mockConfig);
            
            const result = await configManager.refreshCache(guildId);
            
            expect(result).toEqual(mockConfig);
            expect(redis.setex).toHaveBeenCalledWith(`config:${guildId}`, 300, JSON.stringify(mockConfig));
            expect(configManager.cache.get(guildId).config).toEqual(mockConfig);
        });
    });
    
    describe('clearCache', () => {
        const guildId = '1234567890';
        
        test('removes from all cache layers', async () => {
            configManager.cache.set(guildId, { config: {}, timestamp: Date.now() });
            
            await configManager.clearCache(guildId);
            
            expect(configManager.cache.has(guildId)).toBe(false);
            expect(redis.del).toHaveBeenCalledWith(`config:${guildId}`);
        });
    });
});