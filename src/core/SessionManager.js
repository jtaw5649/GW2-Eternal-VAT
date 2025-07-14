class SessionManager {
    constructor(redis) {
        this.redis = redis;
        this.minSessionDuration = 20 * 60 * 1000;
        this.rejoinWindow = 20 * 60 * 1000;
    }

    getActiveSessionKey(guildId, userId) {
        return `voice:${guildId}:active:${userId}`;
    }

    getCompletedSessionsKey(guildId) {
        return `voice:${guildId}:completed`;
    }

    async startSession(guildId, userId, displayName) {
        const now = Date.now();
        const pendingKey = `voice:${guildId}:pending:${userId}`;
        const pendingData = await this.redis.get(pendingKey);
        
        let sessionData;
        if (pendingData) {
            const pending = JSON.parse(pendingData);
            if (now - pending.endTime < 300000) {
                sessionData = {
                    startTime: pending.startTime,
                    totalTime: pending.totalTime,
                    displayName,
                    userId,
                    guildId
                };
                await this.redis.del(pendingKey);
            }
        }
        
        if (!sessionData) {
            sessionData = {
                startTime: now,
                totalTime: 0,
                displayName,
                userId,
                guildId
            };
        }
        
        await this.redis.setex(
            this.getActiveSessionKey(guildId, userId),
            24 * 60 * 60,
            JSON.stringify(sessionData)
        );
    }

    async endSession(guildId, userId) {
        const sessionKey = this.getActiveSessionKey(guildId, userId);
        const sessionData = await this.redis.get(sessionKey);
        
        if (!sessionData) return null;
        
        const session = JSON.parse(sessionData);
        const now = Date.now();
        const totalTime = now - session.startTime + session.totalTime;
        
        await this.redis.del(sessionKey);
        
        if (totalTime < this.minSessionDuration) {
            const pendingKey = `voice:${guildId}:pending:${userId}`;
            session.endTime = now;
            session.totalTime = totalTime;
            await this.redis.setex(pendingKey, 300, JSON.stringify(session));
            return { totalTime, pending: true };
        }
        
        const completedSession = {
            userId,
            displayName: session.displayName,
            totalTime,
            timestamp: now
        };
        
        await this.redis.zadd(
            this.getCompletedSessionsKey(guildId),
            now,
            JSON.stringify(completedSession)
        );
        
        return { totalTime, completed: true };
    }

    async getRecentSession(guildId, userId) {
        const now = Date.now();
        const windowStart = now - this.rejoinWindow;
        
        const recentSessions = await this.redis.zrevrangebyscore(
            this.getCompletedSessionsKey(guildId),
            now,
            windowStart,
            'WITHSCORES'
        );
        
        for (let i = 0; i < recentSessions.length; i += 2) {
            const session = JSON.parse(recentSessions[i]);
            if (session.userId === userId) {
                return session;
            }
        }
        
        return null;
    }

    async resumeSession(guildId, userId, displayName, previousTime) {
        const now = Date.now();
        const sessionData = {
            startTime: now - previousTime,
            totalTime: previousTime,
            displayName,
            userId,
            guildId
        };
        
        await this.redis.setex(
            this.getActiveSessionKey(guildId, userId),
            24 * 60 * 60,
            JSON.stringify(sessionData)
        );
    }

    async removeCompletedSession(guildId, session) {
        await this.redis.zrem(
            this.getCompletedSessionsKey(guildId),
            JSON.stringify(session)
        );
    }
}

module.exports = SessionManager;