const { createTestGuild, createTestMember, Redis } = require('../setup');
const { VoiceMonitorBot } = require('../../src/bot');

describe('Report Generation', () => {
    let bot;
    let mockGuild;
    
    beforeEach(async () => {
        process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
        
        bot = new VoiceMonitorBot();
        
        bot.pgPool = {
            end: jest.fn()
        };
        
        bot.prisma.$disconnect = jest.fn();
        
        mockGuild = createTestGuild();
        mockGuild.members.fetch = jest.fn().mockResolvedValue(true);
        
        const trackedMember1 = createTestMember('111', ['987654321']);
        trackedMember1.displayName = 'TestUser1';
        const trackedMember2 = createTestMember('222', ['987654321']);
        trackedMember2.displayName = 'TestUser2';
        const untrackedMember = createTestMember('333', []);
        
        mockGuild.members.cache.set('111', trackedMember1);
        mockGuild.members.cache.set('222', trackedMember2);
        mockGuild.members.cache.set('333', untrackedMember);
        
        bot.client.guilds.cache.set('1234567890', mockGuild);
    });
    
    afterEach(async () => {
        if (bot && bot.redis) {
            await bot.redis.flushall();
        }
    });
    
    test('generates report with active and inactive users', async () => {
        const config = {
            trackingRoleName: 'Voice Active',
            reportRecipients: ['c:999'],
            minSessionMinutes: 20
        };
        
        const session = {
            userId: '111',
            displayName: 'TestUser1',
            totalTime: 60 * 60 * 1000, // 1 hour
            timestamp: Date.now() - (60 * 60 * 1000)
        };
        
        await bot.redis.zadd(
            'voice:1234567890:completed',
            session.timestamp,
            JSON.stringify(session)
        );
        
        const report = await bot.generateReport(mockGuild, config, 7);
        
        expect(report.data.fields).toContainEqual(
            expect.objectContaining({
                name: expect.stringContaining('Active Users (1)')
            })
        );
        
        expect(report.data.fields).toContainEqual(
            expect.objectContaining({
                name: expect.stringContaining('Inactive Users (1)')
            })
        );
    });
    
    test('includes active sessions in report', async () => {
        const config = {
            trackingRoleName: 'Voice Active',
            reportRecipients: [],
            minSessionMinutes: 20
        };
        
        await bot.sessionManager.startSession('1234567890', '222', 'TestUser2');
        
        const sessionData = await bot.redis.get('voice:1234567890:active:222');
        const session = JSON.parse(sessionData);
        session.startTime = Date.now() - (30 * 60 * 1000);
        await bot.redis.setex(
            'voice:1234567890:active:222',
            3600,
            JSON.stringify(session)
        );
        
        const report = await bot.generateReport(mockGuild, config, 7);
        
        const activeField = report.data.fields.find(f => 
            f.name.includes('Active Users')
        );
        
        expect(activeField.value).toContain('TestUser2');
        expect(activeField.value).toMatch(/\d+h \d+m/);
    });
    
    test('respects minimum session duration', async () => {
        const config = {
            trackingRoleName: 'Voice Active',
            reportRecipients: [],
            minSessionMinutes: 20
        };
        
        const report = await bot.generateReport(mockGuild, config, 7);
        
        const inactiveField = report.data.fields.find(f => 
            f.name.includes('Inactive Users')
        );
        
        expect(inactiveField.value).toContain('TestUser1');
        expect(inactiveField.value).toContain('TestUser2');
    });
});