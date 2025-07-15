const Redis = require('ioredis');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

class MigrationTool {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379
        });
        
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds]
        });
    }

    async migrate() {
        console.log('Starting migration\n');
        
        const requiredVars = ['DISCORD_TOKEN', 'LEGACY_SERVER_ID'];
        for (const varName of requiredVars) {
            if (!process.env[varName]) {
                console.error(`Missing required environment variable: ${varName}`);
                process.exit(1);
            }
        }
        
        const serverId = process.env.LEGACY_SERVER_ID;
        console.log(`Migrating server: ${serverId}`);
        
        try {
            await this.client.login(process.env.DISCORD_TOKEN);
            console.log('Connected to Discord');
            
            await this.migrateServerConfig(serverId);
            await this.migrateActiveSessions(serverId);
            await this.migrateCompletedSessions(serverId);
            await this.verifyMigration(serverId);
            
            console.log('Migration completed successfully');
            
        } catch (error) {
            console.error('Migration failed:', error);
            process.exit(1);
        } finally {
            this.redis.disconnect();
            this.client.destroy();
        }
    }
    
    async migrateServerConfig(serverId) {
        console.log('Migrating server configuration');
        
        const config = {
            trackingRoleName: process.env.LEGACY_TRACKING_ROLE_NAME || 'Voice Active',
            commandRoleId: process.env.LEGACY_COMMAND_ROLE_ID || null,
            reportChannelId: null,
            reportRecipients: [],
            excludedChannelIds: [],
            minSessionMinutes: 20,
            rejoinWindowMinutes: 20,
            weeklyReportEnabled: true,
            weeklyReportDay: 0,
            weeklyReportHour: 9,
            prefix: '!'
        };
        
        if (process.env.LEGACY_REPORT_RECIPIENTS) {
            const recipients = process.env.LEGACY_REPORT_RECIPIENTS.split(',')
                .map(r => r.trim())
                .filter(Boolean);
            
            for (const recipient of recipients) {
                if (recipient.startsWith('c:')) {
                    config.reportChannelId = recipient.substring(2);
                }
                config.reportRecipients.push(recipient);
            }
        }
        
        if (process.env.LEGACY_ERROR_RECIPIENT && 
            !config.reportRecipients.includes(process.env.LEGACY_ERROR_RECIPIENT)) {
            config.reportRecipients.push(process.env.LEGACY_ERROR_RECIPIENT);
        }
        
        await this.redis.set(`config:${serverId}`, JSON.stringify(config));
        console.log('Server configuration migrated');
        console.log(`   - Tracking role: ${config.trackingRoleName}`);
        console.log(`   - Recipients: ${config.reportRecipients.length}`);
    }
    
    async migrateActiveSessions(serverId) {
        console.log('\n🎮 Migrating active sessions');
        
        const oldKeys = await this.redis.keys('voice:active:*');
        let migratedCount = 0;
        
        for (const oldKey of oldKeys) {
            const userId = oldKey.split(':')[2];
            const sessionData = await this.redis.get(oldKey);
            
            if (sessionData) {
                const session = JSON.parse(sessionData);
                session.guildId = serverId;
                
                const newKey = `voice:${serverId}:active:${userId}`;
                const ttl = await this.redis.ttl(oldKey);
                
                if (ttl > 0) {
                    await this.redis.setex(newKey, ttl, JSON.stringify(session));
                } else {
                    await this.redis.set(newKey, JSON.stringify(session));
                }
                
                await this.redis.del(oldKey);
                migratedCount++;
            }
        }
        
        console.log(`Migrated ${migratedCount} active sessions`);
    }
    
    async migrateCompletedSessions(serverId) {
        console.log('Migrating completed sessions');
        
        const oldKey = 'voice:completed';
        const newKey = `voice:${serverId}:completed`;
        
        const sessions = await this.redis.zrange(oldKey, 0, -1, 'WITHSCORES');
        let migratedCount = 0;
        
        for (let i = 0; i < sessions.length; i += 2) {
            const sessionStr = sessions[i];
            const score = sessions[i + 1];
            
            try {
                const session = JSON.parse(sessionStr);
                session.guildId = serverId;
                
                await this.redis.zadd(newKey, score, JSON.stringify(session));
                migratedCount++;
            } catch (error) {
                console.warn(`Failed to migrate session: ${error.message}`);
            }
        }
        
        if (process.env.KEEP_BACKUP === 'true') {
            await this.redis.rename(oldKey, `${oldKey}:backup`);
            console.log('Old data backed up to voice:completed:backup');
        } else {
            await this.redis.del(oldKey);
        }
        
        console.log(`Migrated ${migratedCount} completed sessions`);
    }
    
    async verifyMigration(serverId) {
        console.log('Verifying migration');
        
        const config = await this.redis.get(`config:${serverId}`);
        if (!config) {
            throw new Error('Server configuration not found after migration');
        }
        
        const activeKeys = await this.redis.keys(`voice:${serverId}:active:*`);
        const completedCount = await this.redis.zcard(`voice:${serverId}:completed`);
        
        console.log('Migration verified:');
        console.log(`   - Active sessions: ${activeKeys.length}`);
        console.log(`   - Completed sessions: ${completedCount}`);
        
        const oldActiveKeys = await this.redis.keys('voice:active:*');
        const oldCompleted = await this.redis.exists('voice:completed');
        
        if (oldActiveKeys.length > 0 || oldCompleted) {
            console.warn('Warning: Some old keys still exist');
            console.warn(`   - Old active sessions: ${oldActiveKeys.length}`);
            console.warn(`   - Old completed key exists: ${oldCompleted === 1}`);
        }
    }
}

if (require.main === module) {
    const migrator = new MigrationTool();
    migrator.migrate().catch(console.error);
}

module.exports = MigrationTool;