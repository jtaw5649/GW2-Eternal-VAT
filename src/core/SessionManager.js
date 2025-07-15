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

    getPausedSessionKey(guildId, userId) {
        return `voice:${guildId}:paused:${userId}`;
    }

    async startSession(guildId, userId, displayName, isMuted = false) {
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
                    mutedTime: pending.mutedTime || 0,
                    unmutedTime: pending.unmutedTime || 0,
                    displayName,
                    userId,
                    guildId,
                    lastMuteCheck: now,
                    isMuted
                };
                await this.redis.del(pendingKey);
            }
        }
        
        if (!sessionData) {
            sessionData = {
                startTime: now,
                totalTime: 0,
                mutedTime: 0,
                unmutedTime: 0,
                displayName,
                userId,
                guildId,
                lastMuteCheck: now,
                isMuted
            };
        }
        
        await this.redis.setex(
            this.getActiveSessionKey(guildId, userId),
            24 * 60 * 60,
            JSON.stringify(sessionData)
        );
    }

    async pauseSession(guildId, userId, reason = 'deafened') {
        const sessionKey = this.getActiveSessionKey(guildId, userId);
        const sessionData = await this.redis.get(sessionKey);
        
        if (!sessionData) return null;
        
        const session = JSON.parse(sessionData);
        const now = Date.now();
        
        const timeSinceLastCheck = now - session.lastMuteCheck;
        if (session.isMuted) {
            session.mutedTime += timeSinceLastCheck;
        } else {
            session.unmutedTime += timeSinceLastCheck;
        }
        
        session.totalTime = now - session.startTime + (session.totalTime || 0);
        session.pausedAt = now;
        session.pauseReason = reason;
        
        const pausedKey = this.getPausedSessionKey(guildId, userId);
        await this.redis.setex(pausedKey, 24 * 60 * 60, JSON.stringify(session));
        await this.redis.del(sessionKey);
        
        return session;
    }

    async resumeSession(guildId, userId, displayName) {
        const pausedKey = this.getPausedSessionKey(guildId, userId);
        const pausedData = await this.redis.get(pausedKey);
        
        if (!pausedData) return null;
        
        const session = JSON.parse(pausedData);
        const now = Date.now();
        
        session.startTime = now;
        session.displayName = displayName;
        session.lastMuteCheck = now;
        delete session.pausedAt;
        delete session.pauseReason;
        
        await this.redis.setex(
            this.getActiveSessionKey(guildId, userId),
            24 * 60 * 60,
            JSON.stringify(session)
        );
        await this.redis.del(pausedKey);
        
        return session;
    }

    async updateMuteStatus(guildId, userId, isMuted) {
        const sessionKey = this.getActiveSessionKey(guildId, userId);
        const sessionData = await this.redis.get(sessionKey);
        
        if (!sessionData) return;
        
        const session = JSON.parse(sessionData);
        const now = Date.now();
        const timeSinceLastCheck = now - session.lastMuteCheck;
        
        if (session.isMuted) {
            session.mutedTime = (session.mutedTime || 0) + timeSinceLastCheck;
        } else {
            session.unmutedTime = (session.unmutedTime || 0) + timeSinceLastCheck;
        }
        
        session.isMuted = isMuted;
        session.lastMuteCheck = now;
        
        await this.redis.setex(
            this.getActiveSessionKey(guildId, userId),
            24 * 60 * 60,
            JSON.stringify(session)
        );
    }

    async endSession(guildId, userId) {
        const sessionKey = this.getActiveSessionKey(guildId, userId);
        const sessionData = await this.redis.get(sessionKey);
        
        if (!sessionData) return null;
        
        const session = JSON.parse(sessionData);
        const now = Date.now();
        
        const timeSinceLastCheck = now - session.lastMuteCheck;
        if (session.isMuted) {
            session.mutedTime = (session.mutedTime || 0) + timeSinceLastCheck;
        } else {
            session.unmutedTime = (session.unmutedTime || 0) + timeSinceLastCheck;
        }
        
        const totalTime = now - session.startTime + (session.totalTime || 0);
        
        await this.redis.del(sessionKey);
        
        if (totalTime < this.minSessionDuration) {
            const pendingKey = `voice:${guildId}:pending:${userId}`;
            session.endTime = now;
            session.totalTime = totalTime;
            await this.redis.setex(pendingKey, 300, JSON.stringify(session));
            return { totalTime, pending: true };
        }
        
        const mutePercentage = totalTime > 0 
            ? Math.round(((session.mutedTime || 0) / totalTime) * 100)
            : 0;
        
        const completedSession = {
            userId,
            displayName: session.displayName,
            totalTime,
            mutedTime: session.mutedTime || 0,
            unmutedTime: session.unmutedTime || 0,
            mutePercentage,
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

    async removeCompletedSession(guildId, session) {
        await this.redis.zrem(
            this.getCompletedSessionsKey(guildId),
            JSON.stringify(session)
        );
    }

    async getSuspiciousUsers(guildId, days = 7) {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const sessions = await this.redis.zrangebyscore(
            this.getCompletedSessionsKey(guildId),
            cutoff,
            Date.now()
        );
        
        const userStats = new Map();
        
        for (const sessionStr of sessions) {
            const session = JSON.parse(sessionStr);
            if (!userStats.has(session.userId)) {
                userStats.set(session.userId, {
                    displayName: session.displayName,
                    totalTime: 0,
                    sessionCount: 0,
                    totalMutedTime: 0,
                    dailyTime: new Map(),
                    mutePercentages: []
                });
            }
            
            const stats = userStats.get(session.userId);
            stats.totalTime += session.totalTime;
            stats.totalMutedTime += session.mutedTime || 0;
            stats.sessionCount++;
            
            if (session.mutePercentage !== undefined) {
                stats.mutePercentages.push(session.mutePercentage);
            }
            
            const date = new Date(session.timestamp).toDateString();
            const dailyTime = stats.dailyTime.get(date) || 0;
            stats.dailyTime.set(date, dailyTime + session.totalTime);
        }
        
        const suspicious = [];
        
        for (const [userId, stats] of userStats) {
            const flags = [];
            
            for (const [date, time] of stats.dailyTime) {
                if (time > 20 * 60 * 60 * 1000) {
                    flags.push({
                        type: 'excessive_daily',
                        detail: `${Math.round(time / (60 * 60 * 1000))} hours on ${date}`
                    });
                }
            }
            
            const avgMutePercentage = stats.mutePercentages.length > 0
                ? Math.round(stats.mutePercentages.reduce((a, b) => a + b, 0) / stats.mutePercentages.length)
                : 0;
            
            if (avgMutePercentage === 100 && stats.sessionCount > 5) {
                flags.push({
                    type: 'always_muted',
                    detail: `100% muted across ${stats.sessionCount} sessions`
                });
            }
            
            const avgDailyTime = stats.totalTime / days;
            if (avgDailyTime > 16 * 60 * 60 * 1000) {
                flags.push({
                    type: 'excessive_average',
                    detail: `${Math.round(avgDailyTime / (60 * 60 * 1000))} hours average per day`
                });
            }
            
            if (flags.length > 0) {
                suspicious.push({
                    userId,
                    displayName: stats.displayName,
                    flags,
                    stats: {
                        totalTime: stats.totalTime,
                        sessionCount: stats.sessionCount,
                        avgMutePercentage,
                        avgDailyHours: Math.round(avgDailyTime / (60 * 60 * 1000) * 10) / 10
                    }
                });
            }
        }
        
        return suspicious;
    }
}

module.exports = SessionManager;