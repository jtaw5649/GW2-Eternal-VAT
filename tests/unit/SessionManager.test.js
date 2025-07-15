const { Redis } = require('../setup');
const { SessionManager } = require('../../src/bot');

describe('SessionManager', () => {
    let redis;
    let sessionManager;
    
    beforeEach(() => {
        redis = new Redis();
        sessionManager = new SessionManager(redis);
    });
    
    afterEach(async () => {
        await redis.flushall();
        jest.clearAllMocks();
    });
    
    describe('startSession', () => {
        test('creates new session with correct data', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            const displayName = 'TestUser';
            
            await sessionManager.startSession(guildId, userId, displayName);
            
            const sessionKey = `voice:${guildId}:active:${userId}`;
            const sessionData = await redis.get(sessionKey);
            const session = JSON.parse(sessionData);
            
            expect(session).toMatchObject({
                userId,
                displayName,
                guildId,
                totalTime: 0
            });
            expect(session.startTime).toBeDefined();
            expect(typeof session.startTime).toBe('number');
        });
        
        test('sets correct TTL on session', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            
            await sessionManager.startSession(guildId, userId, 'TestUser');
            
            const ttl = await redis.ttl(`voice:${guildId}:active:${userId}`);
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
        });
    });
    
    describe('endSession', () => {
        test('calculates total time correctly', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            const startTime = Date.now() - (30 * 60 * 1000); // 30 minutes ago
            
            await redis.setex(
                `voice:${guildId}:active:${userId}`,
                3600,
                JSON.stringify({
                    startTime,
                    totalTime: 0,
                    displayName: 'TestUser',
                    userId,
                    guildId
                })
            );
            
            const result = await sessionManager.endSession(guildId, userId);
            
            expect(result.totalTime).toBeGreaterThanOrEqual(30 * 60 * 1000);
            expect(result.totalTime).toBeLessThan(31 * 60 * 1000);
        });
        
        test('saves completed session if meets minimum duration', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            const startTime = Date.now() - (25 * 60 * 1000); // 25 minutes
            
            await redis.setex(
                `voice:${guildId}:active:${userId}`,
                3600,
                JSON.stringify({
                    startTime,
                    totalTime: 0,
                    displayName: 'TestUser',
                    userId,
                    guildId
                })
            );
            
            await sessionManager.endSession(guildId, userId);
            
            const completedSessions = await redis.zrange(
                `voice:${guildId}:completed`,
                0,
                -1
            );
            
            expect(completedSessions.length).toBe(1);
            const session = JSON.parse(completedSessions[0]);
            expect(session.userId).toBe(userId);
        });
        
        test('does not save session if below minimum duration', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            const startTime = Date.now() - (10 * 60 * 1000); // 10 minutes
            
            await redis.setex(
                `voice:${guildId}:active:${userId}`,
                3600,
                JSON.stringify({
                    startTime,
                    totalTime: 0,
                    displayName: 'TestUser',
                    userId,
                    guildId
                })
            );
            
            await sessionManager.endSession(guildId, userId);
            
            const completedCount = await redis.zcard(`voice:${guildId}:completed`);
            expect(completedCount).toBe(0);
        });
        
        test('removes active session', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            
            await sessionManager.startSession(guildId, userId, 'TestUser');
            await sessionManager.endSession(guildId, userId);
            
            const activeSession = await redis.get(`voice:${guildId}:active:${userId}`);
            expect(activeSession).toBeNull();
        });
    });
    
    describe('getRecentSession', () => {
        test('finds session within rejoin window', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            const now = Date.now();
            const session = {
                userId,
                displayName: 'TestUser',
                totalTime: 30 * 60 * 1000,
                timestamp: now - (10 * 60 * 1000) // 10 minutes ago
            };
            
            await redis.zadd(
                `voice:${guildId}:completed`,
                session.timestamp,
                JSON.stringify(session)
            );
            
            const result = await sessionManager.getRecentSession(guildId, userId);
            
            expect(result).toEqual(session);
        });
        
        test('returns null for session outside rejoin window', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            const session = {
                userId,
                displayName: 'TestUser',
                totalTime: 30 * 60 * 1000,
                timestamp: Date.now() - (25 * 60 * 1000) // 25 minutes ago
            };
            
            await redis.zadd(
                `voice:${guildId}:completed`,
                session.timestamp,
                JSON.stringify(session)
            );
            
            const result = await sessionManager.getRecentSession(guildId, userId);
            
            expect(result).toBeNull();
        });
    });
    
    describe('resumeSession', () => {
        test('creates session with previous time included', async () => {
            const guildId = '1234567890';
            const userId = '9876543210';
            const previousTime = 30 * 60 * 1000; // 30 minutes
            
            await sessionManager.resumeSession(guildId, userId, 'TestUser', previousTime);
            
            const sessionData = await redis.get(`voice:${guildId}:active:${userId}`);
            const session = JSON.parse(sessionData);
            
            expect(session.totalTime).toBe(previousTime);
            expect(session.startTime).toBeLessThan(Date.now());
        });
    });
    
    describe('removeCompletedSession', () => {
        test('removes specific session from completed set', async () => {
            const guildId = '1234567890';
            const session1 = {
                userId: '111',
                displayName: 'User1',
                totalTime: 1000,
                timestamp: Date.now()
            };
            const session2 = {
                userId: '222',
                displayName: 'User2',
                totalTime: 2000,
                timestamp: Date.now()
            };
            
            await redis.zadd(
                `voice:${guildId}:completed`,
                session1.timestamp,
                JSON.stringify(session1)
            );
            await redis.zadd(
                `voice:${guildId}:completed`,
                session2.timestamp,
                JSON.stringify(session2)
            );
            
            await sessionManager.removeCompletedSession(guildId, session1);
            
            const remaining = await redis.zrange(`voice:${guildId}:completed`, 0, -1);
            expect(remaining.length).toBe(1);
            expect(JSON.parse(remaining[0]).userId).toBe('222');
        });
    });
});
