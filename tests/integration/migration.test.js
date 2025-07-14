const { Redis } = require('../setup');
const MigrationTool = require('../../src/migrate');

describe('Migration Tool', () => {
    let migrator;
    let redis;
    
    beforeEach(() => {
        process.env.LEGACY_SERVER_ID = '1234567890';
        process.env.LEGACY_TRACKING_ROLE_NAME = 'PEST';
        process.env.LEGACY_REPORT_RECIPIENTS = 'c:999,111,222';
        process.env.LEGACY_ERROR_RECIPIENT = '333';
        
        redis = new Redis();
        migrator = new MigrationTool();
        migrator.redis = redis;
        migrator.client = {
            login: jest.fn().mockResolvedValue(true),
            destroy: jest.fn()
        };
    });
    
    afterEach(async () => {
        await redis.flushall();
    });
    
    test('migrates server configuration', async () => {
        await migrator.migrateServerConfig('1234567890');
        
        const config = await redis.get('config:1234567890');
        const parsed = JSON.parse(config);
        
        expect(parsed).toMatchObject({
            trackingRoleName: 'PEST',
            reportChannelId: '999',
            reportRecipients: ['c:999', '111', '222', '333'],
            excludedChannelIds: []
        });
    });
    
    test('migrates active sessions', async () => {
        await redis.setex('voice:active:111', 3600, JSON.stringify({
            startTime: Date.now(),
            totalTime: 0,
            displayName: 'User1',
            userId: '111'
        }));
        
        await redis.setex('voice:active:222', 3600, JSON.stringify({
            startTime: Date.now(),
            totalTime: 1000,
            displayName: 'User2',
            userId: '222'
        }));
        
        await migrator.migrateActiveSessions('1234567890');
        
        const newSession1 = await redis.get('voice:1234567890:active:111');
        const newSession2 = await redis.get('voice:1234567890:active:222');
        
        expect(newSession1).toBeTruthy();
        expect(JSON.parse(newSession1).guildId).toBe('1234567890');
        expect(newSession2).toBeTruthy();
        
        const oldSession1 = await redis.get('voice:active:111');
        expect(oldSession1).toBeNull();
    });
    
    test('migrates completed sessions', async () => {
        const sessions = [
            { userId: '111', displayName: 'User1', totalTime: 3600000, timestamp: Date.now() },
            { userId: '222', displayName: 'User2', totalTime: 1800000, timestamp: Date.now() }
        ];
        
        for (const session of sessions) {
            await redis.zadd('voice:completed', session.timestamp, JSON.stringify(session));
        }
        
        await migrator.migrateCompletedSessions('1234567890');
        
        const newSessions = await redis.zrange('voice:1234567890:completed', 0, -1);
        expect(newSessions.length).toBe(2);
        
        const parsed = JSON.parse(newSessions[0]);
        expect(parsed.guildId).toBe('1234567890');
    });
});