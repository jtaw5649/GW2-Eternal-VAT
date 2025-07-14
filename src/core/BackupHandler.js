const { WebhookClient, AttachmentBuilder } = require('discord.js');
const cron = require('node-cron');

class BackupHandler {
    constructor(client) {
        this.client = client;
        this.webhookUrl = process.env.LOG_WEBHOOK_URL;
        this.webhookClient = null;
        
        if (this.webhookUrl) {
            const match = this.webhookUrl.match(/discord\.com\/api\/webhooks\/(\d+)\/(.+)/);
            if (match) {
                this.webhookClient = new WebhookClient({ id: match[1], token: match[2] });
            }
        }
    }

    startBackupSchedule() {
        cron.schedule('0 3 * * *', async () => {
            await this.performBackup();
        }, {
            timezone: 'UTC'
        });
        
        this.client.logger.info('Backup schedule started - daily at 3 AM UTC');
    }

    async performBackup() {
        if (!this.webhookClient) {
            this.client.logger.warn('Backup skipped - no webhook configured');
            return;
        }

        try {
            const date = new Date().toISOString().split('T')[0];
            const backups = [];

            for (const [guildId, guild] of this.client.guilds.cache) {
                const backup = await this.backupGuild(guildId, guild.name);
                if (backup) {
                    backups.push(backup);
                }
            }

            if (backups.length === 0) {
                this.client.logger.info('No data to backup');
                return;
            }

            const chunks = this.chunkBackupData(backups, 8000000);
            
            for (let i = 0; i < chunks.length; i++) {
                const filename = `backup-${date}-part${i + 1}.json`;
                const attachment = new AttachmentBuilder(
                    Buffer.from(JSON.stringify(chunks[i], null, 2)),
                    { name: filename }
                );

                await this.webhookClient.send({
                    content: `📦 Daily Backup - ${date} (Part ${i + 1}/${chunks.length})`,
                    files: [attachment]
                });
            }

            this.client.logger.info(`Backup completed - ${chunks.length} files sent`);
        } catch (error) {
            this.client.logger.error('Backup failed', error);
        }
    }

    async backupGuild(guildId, guildName) {
        try {
            const completedKey = `voice:${guildId}:completed`;
            const sessions = await this.client.redis.zrange(completedKey, 0, -1, 'WITHSCORES');
            
            if (sessions.length === 0) return null;

            const data = {
                guildId,
                guildName,
                backupDate: new Date().toISOString(),
                sessions: []
            };

            for (let i = 0; i < sessions.length; i += 2) {
                const session = JSON.parse(sessions[i]);
                const timestamp = parseInt(sessions[i + 1]);
                data.sessions.push({
                    ...session,
                    timestamp
                });
            }

            const config = await this.client.configManager.getServerConfig(guildId);
            if (config) {
                data.config = config;
            }

            return data;
        } catch (error) {
            this.client.logger.error(`Backup failed for guild ${guildId}`, error);
            return null;
        }
    }

    chunkBackupData(backups, maxSize) {
        const chunks = [];
        let currentChunk = [];
        let currentSize = 0;

        for (const backup of backups) {
            const backupStr = JSON.stringify(backup);
            const backupSize = Buffer.byteLength(backupStr);

            if (currentSize + backupSize > maxSize && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentSize = 0;
            }

            currentChunk.push(backup);
            currentSize += backupSize;
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    async restoreBackup(fileContent) {
        try {
            const data = JSON.parse(fileContent);
            let restoredCount = 0;

            const backups = Array.isArray(data) ? data : [data];

            for (const backup of backups) {
                if (!backup.guildId || !backup.sessions) continue;

                const completedKey = `voice:${backup.guildId}:completed`;
                
                for (const session of backup.sessions) {
                    await this.client.redis.zadd(
                        completedKey,
                        session.timestamp,
                        JSON.stringify({
                            userId: session.userId,
                            displayName: session.displayName,
                            totalTime: session.totalTime,
                            timestamp: session.timestamp
                        })
                    );
                    restoredCount++;
                }
            }

            return { success: true, restoredCount };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = BackupHandler;