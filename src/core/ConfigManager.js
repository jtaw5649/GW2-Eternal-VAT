class ConfigManager {
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000;
    }

    async getServerConfig(guildId) {
        const cached = this.cache.get(guildId);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.config;
        }

        const redisConfig = await this.redis.get(`config:${guildId}`);
        if (redisConfig) {
            const config = JSON.parse(redisConfig);
            this.cache.set(guildId, { config, timestamp: Date.now() });
            return config;
        }

        const config = await this.prisma.serverConfig.findUnique({
            where: { guildId }
        });

        if (config) {
            await this.redis.setex(`config:${guildId}`, 300, JSON.stringify(config));
            this.cache.set(guildId, { config, timestamp: Date.now() });
        }

        return config;
    }

    async refreshCache(guildId) {
        const config = await this.prisma.serverConfig.findUnique({
            where: { guildId }
        });

        if (config) {
            await this.redis.setex(`config:${guildId}`, 300, JSON.stringify(config));
            this.cache.set(guildId, { config, timestamp: Date.now() });
        }
        
        return config;
    }

    async clearCache(guildId) {
        await this.redis.del(`config:${guildId}`);
        this.cache.delete(guildId);
    }
}

module.exports = ConfigManager;