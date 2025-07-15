const { createTestGuild, createTestMember, Redis } = require('../setup');
const { VoiceMonitorBot } = require('../../src/bot');

describe('Voice State Updates', () => {
    let bot;
    let mockGuild;
    let mockMember;
    
    beforeEach(async () => {
        bot = new VoiceMonitorBot();
        bot.redis = new Redis();
        
        bot.prisma = {
            serverConfig: {
                findUnique: jest.fn().mockResolvedValue({
                    guildId: '1234567890',
                    trackingRoleName: 'Voice Active',
                    minSessionMinutes: 20,
                    rejoinWindowMinutes: 20,
                    excludedChannelIds: []
                }),
                create: jest.fn().mockResolvedValue(true),
                update: jest.fn().mockResolvedValue(true)
            },
            $disconnect: jest.fn()
        };
        
        mockGuild = createTestGuild();
        mockMember = createTestMember('111111111', ['987654321']);
        
        bot.configManager.cache.set('1234567890', {
            config: {
                guildId: '1234567890',
                trackingRoleName: 'Voice Active',
                minSessionMinutes: 20,
                rejoinWindowMinutes: 20
            },
            timestamp: Date.now()
        });
    });
    
    afterEach(async () => {
        await bot.redis.flushall();
    });
    
    describe('User joins voice channel', () => {
        test('starts new session when user joins', async () => {
            const oldState = { channel: null, member: mockMember, guild: mockGuild };
            const newState = { 
                channel: { id: '123', name: 'General', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            
            await bot.onVoiceStateUpdate(oldState, newState);
            
            const session = await bot.redis.get('voice:1234567890:active:111111111');
            expect(session).toBeTruthy();
            const parsed = JSON.parse(session);
            expect(parsed.userId).toBe('111111111');
            expect(parsed.displayName).toBe('TestUser');
        });
        
        test('ignores users without tracking role', async () => {
            mockMember.roles.cache.clear();
            
            const oldState = { channel: null, member: mockMember, guild: mockGuild };
            const newState = { 
                channel: { id: '123', name: 'General', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            
            await bot.onVoiceStateUpdate(oldState, newState);
            
            const session = await bot.redis.get('voice:1234567890:active:111111111');
            expect(session).toBeNull();
        });
        
        test('ignores excluded channel', async () => {
            bot.configManager.cache.get('1234567890').config.excludedChannelIds = ['123'];
            
            const oldState = { channel: null, member: mockMember, guild: mockGuild };
            const newState = { 
                channel: { id: '123', name: 'General', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            
            await bot.onVoiceStateUpdate(oldState, newState);
            
            const session = await bot.redis.get('voice:1234567890:active:111111111');
            expect(session).toBeNull();
        });
        
        test('resumes recent session if within rejoin window', async () => {
            const recentSession = {
                userId: '111111111',
                displayName: 'TestUser',
                totalTime: 30 * 60 * 1000, // 30 minutes
                timestamp: Date.now() - (10 * 60 * 1000) // 10 minutes ago
            };
            
            await bot.redis.zadd(
                'voice:1234567890:completed',
                recentSession.timestamp,
                JSON.stringify(recentSession)
            );
            
            const oldState = { channel: null, member: mockMember, guild: mockGuild };
            const newState = { 
                channel: { id: '123', name: 'General', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            
            await bot.onVoiceStateUpdate(oldState, newState);
            
            const session = await bot.redis.get('voice:1234567890:active:111111111');
            const parsed = JSON.parse(session);
            expect(parsed.totalTime).toBe(30 * 60 * 1000);
        });
    });
    
    describe('User leaves voice channel', () => {
        beforeEach(async () => {
            await bot.sessionManager.startSession('1234567890', '111111111', 'TestUser');
        });
        
        test('ends session when user leaves', async () => {
            const oldState = { 
                channel: { id: '123', name: 'General', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            const newState = { channel: null, member: mockMember, guild: mockGuild };
            
            await bot.onVoiceStateUpdate(oldState, newState);
            
            const activeSession = await bot.redis.get('voice:1234567890:active:111111111');
            expect(activeSession).toBeNull();
        });
        
        test('ends session when user moves to excluded channel', async () => {
            bot.configManager.cache.get('1234567890').config.excludedChannelIds = ['456'];
            
            const oldState = { 
                channel: { id: '123', name: 'General', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            const newState = { 
                channel: { id: '456', name: 'NoTrack', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            
            await bot.onVoiceStateUpdate(oldState, newState);
            
            const activeSession = await bot.redis.get('voice:1234567890:active:111111111');
            expect(activeSession).toBeNull();
        });
    });
    
    describe('User moves between channels', () => {
        test('maintains session when moving between non-AFK channels', async () => {
            await bot.sessionManager.startSession('1234567890', '111111111', 'TestUser');
            
            const oldState = { 
                channel: { id: '123', name: 'General', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            const newState = { 
                channel: { id: '456', name: 'Gaming', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            
            await bot.onVoiceStateUpdate(oldState, newState);
            
            const session = await bot.redis.get('voice:1234567890:active:111111111');
            expect(session).toBeTruthy();
        });
        
        test('resumes session when moving from excluded to active channel', async () => {
            bot.configManager.cache.get('1234567890').config.excludedChannelIds = ['123'];
            
            const oldState = { 
                channel: { id: '123', name: 'NoTrack', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            const newState = { 
                channel: { id: '456', name: 'General', type: 2 }, 
                member: mockMember, 
                guild: mockGuild 
            };
            
            await bot.onVoiceStateUpdate(oldState, newState);
            
            const session = await bot.redis.get('voice:1234567890:active:111111111');
            expect(session).toBeTruthy();
        });
    });
});