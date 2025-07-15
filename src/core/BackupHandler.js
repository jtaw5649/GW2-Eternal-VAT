const { WebhookClient } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

class BackupHandler {
    constructor(client) {
        this.client = client;
        this.webhookUrl = process.env.LOG_WEBHOOK_URL;
        this.webhookClient = null;
        this.backupDir = '/backups';
        
        if (this.webhookUrl) {
            const match = this.webhookUrl.match(/discord\.com\/api\/webhooks\/(\d+)\/(.+)/);
            if (match) {
                this.webhookClient = new WebhookClient({ id: match[1], token: match[2] });
            }
        }
    }

    async ensureBackupDirectory() {
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
            if (this.client.logger) {
                this.client.logger.info(`Backup directory ensured at: ${this.backupDir}`);
            }
            return true;
        } catch (error) {
            if (this.client.logger) {
                this.client.logger.error('Failed to create backup directory:', error);
            }
            return false;
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
        try {
            const dirCreated = await this.ensureBackupDirectory();
            if (!dirCreated) {
                throw new Error('Failed to create backup directory');
            }

            const date = new Date().toISOString().split('T')[0];
            const backupResults = [];

            for (const [guildId, guild] of this.client.guilds.cache) {
                const backup = await this.backupGuild(guildId, guild.name);
                if (backup) {
                    const saved = await this.saveGuildBackupLocally(backup, date);
                    
                    if (saved) {
                        const uniqueUsers = new Set(backup.sessions.map(s => s.userId)).size;
                        
                        backupResults.push({
                            guildId,
                            guildName: guild.name,
                            sessionCount: backup.sessions.length,
                            uniqueUsers: uniqueUsers,
                            success: true
                        });
                    }
                }
            }

            if (backupResults.length === 0) {
                this.client.logger.info('No data to backup');
                return { success: true, count: 0 };
            }

            if (this.webhookClient) {
                const embed = {
                    title: '📦 Daily Backup Complete',
                    description: `Backed up ${backupResults.length} servers on ${date}`,
                    color: 0x00FF88,
                    fields: backupResults.slice(0, 25).map(result => ({
                        name: result.guildName,
                        value: `${result.uniqueUsers} users, ${result.sessionCount} sessions`,
                        inline: true
                    })),
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'GW2 Eternal VAT Backup System'
                    }
                };

                if (backupResults.length > 25) {
                    embed.description += `\n\n*Showing first 25 of ${backupResults.length} servers*`;
                }

                await this.webhookClient.send({
                    embeds: [embed]
                });
            }

            this.client.logger.info(`Backup completed - ${backupResults.length} guilds backed up`);
            this.client.logger.info(`Backups saved to: ${this.backupDir}`);
            
            return { success: true, count: backupResults.length };
        } catch (error) {
            this.client.logger.error('Backup failed', error);
            
            if (this.webhookClient) {
                await this.webhookClient.send({
                    embeds: [{
                        title: '❌ Backup Failed',
                        description: 'An error occurred during the backup process',
                        color: 0xFF0000,
                        fields: [{
                            name: 'Error',
                            value: `\`\`\`${error.message}\`\`\``
                        }],
                        timestamp: new Date().toISOString()
                    }]
                });
            }
            
            return { success: false, error: error.message };
        }
    }

    sanitizeFolderName(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    }

    async saveGuildBackupLocally(backup, date) {
        try {
            const folderName = this.sanitizeFolderName(backup.guildName);
            const guildDir = path.join(this.backupDir, folderName);
            await fs.mkdir(guildDir, { recursive: true });
            
            const infoPath = path.join(guildDir, 'guild-info.json');
            const guildInfo = {
                guildId: backup.guildId,
                guildName: backup.guildName,
                folderName: folderName,
                lastBackup: date,
                createdAt: new Date().toISOString()
            };
            
            try {
                const existingInfo = await fs.readFile(infoPath, 'utf8');
                const existing = JSON.parse(existingInfo);
                guildInfo.createdAt = existing.createdAt;
            } catch {
            }
            
            guildInfo.lastBackup = date;
            
            await fs.writeFile(infoPath, JSON.stringify(guildInfo, null, 2));
            
            const filename = `backup-${date}.json`;
            const filepath = path.join(guildDir, filename);
            
            await fs.writeFile(filepath, JSON.stringify(backup, null, 2));
            
            await this.cleanupOldBackups(guildDir, 30);
            
            this.client.logger.info(`Saved backup for ${backup.guildName} at ${filepath}`);
            return true;
        } catch (error) {
            this.client.logger.error(`Failed to save local backup for guild ${backup.guildId}`, error);
            return false;
        }
    }

    async cleanupOldBackups(guildDir, keepCount) {
        try {
            const files = await fs.readdir(guildDir);
            const backupFiles = files
                .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
                .sort()
                .reverse();
            
            if (backupFiles.length > keepCount) {
                const toDelete = backupFiles.slice(keepCount);
                for (const file of toDelete) {
                    await fs.unlink(path.join(guildDir, file));
                    this.client.logger.info(`Deleted old backup: ${file}`);
                }
            }
        } catch (error) {
            this.client.logger.error('Failed to cleanup old backups', error);
        }
    }

    async getAllBackupServers() {
        try {
            await this.ensureBackupDirectory();
            
            const directories = await fs.readdir(this.backupDir);
            const servers = [];
            
            for (const dir of directories) {
                const dirPath = path.join(this.backupDir, dir);
                const stats = await fs.stat(dirPath);
                
                if (stats.isDirectory()) {
                    try {
                        const infoPath = path.join(dirPath, 'guild-info.json');
                        const infoContent = await fs.readFile(infoPath, 'utf8');
                        const info = JSON.parse(infoContent);
                        
                        servers.push({
                            guildId: info.guildId,
                            guildName: info.guildName,
                            folderName: info.folderName,
                            lastBackup: info.lastBackup
                        });
                    } catch {
                        continue;
                    }
                }
            }
            
            return servers.sort((a, b) => a.guildName.localeCompare(b.guildName));
        } catch (error) {
            this.client.logger.error('Failed to get backup servers', error);
            return [];
        }
    }

    async getAvailableBackups(guildId) {
        try {
            const directories = await fs.readdir(this.backupDir).catch(err => {
                this.client.logger.error('Failed to read backup directory', err, {
                    directory: this.backupDir
                });
                return [];
            });
            
            let guildDir = null;
            let guildInfo = null;
            
            for (const dir of directories) {
                const dirPath = path.join(this.backupDir, dir);
                
                try {
                    const stats = await fs.stat(dirPath);
                    
                    if (stats.isDirectory()) {
                        const infoPath = path.join(dirPath, 'guild-info.json');
                        const infoContent = await fs.readFile(infoPath, 'utf8');
                        const info = JSON.parse(infoContent);
                        
                        if (info.guildId === guildId) {
                            guildDir = dirPath;
                            guildInfo = info;
                            break;
                        }
                    }
                } catch (err) {
                    continue;
                }
            }
            
            if (!guildDir) {
                this.client.logger.info(`No backup directory found for guild ${guildId}`);
                return [];
            }
            
            const files = await fs.readdir(guildDir);
            const backupFiles = files
                .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
                .sort()
                .reverse();
            
            const backups = [];
            for (const file of backupFiles) {
                const filepath = path.join(guildDir, file);
                const stats = await fs.stat(filepath);
                const dateMatch = file.match(/backup-(\d{4}-\d{2}-\d{2})\.json/);
                
                if (dateMatch) {
                    backups.push({
                        filename: file,
                        date: dateMatch[1],
                        size: stats.size,
                        path: filepath,
                        guildName: guildInfo.guildName,
                        folderName: guildInfo.folderName
                    });
                }
            }
            
            this.client.logger.info(`Found ${backups.length} backups for guild ${guildId} (${guildInfo.guildName})`);
            return backups;
        } catch (error) {
            this.client.logger.error(`Failed to get available backups for guild ${guildId}`, error, {
                guildId: guildId
            });
            return [];
        }
    }

    async restoreFromFile(guildId, filename) {
        try {
            const backups = await this.getAvailableBackups(guildId);
            const backup = backups.find(b => b.filename === filename);
            
            if (!backup) {
                throw new Error('Backup file not found');
            }
            
            const fileContent = await fs.readFile(backup.path, 'utf8');
            return await this.restoreBackup(fileContent);
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async backupGuild(guildId, guildName) {
        try {
            const completedKey = `voice:${guildId}:completed`;
            const sessions = await this.client.redis.zrange(completedKey, 0, -1, 'WITHSCORES');
            
            if (sessions.length === 0) {
                this.client.logger.info(`No sessions to backup for ${guildName}`);
                return null;
            }

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
                const { id, createdAt, updatedAt, prefix, ...configData } = config;
                data.config = configData;
            }

            this.client.logger.info(`Prepared backup for ${guildName}: ${data.sessions.length} sessions`);
            return data;
        } catch (error) {
            this.client.logger.error(`Backup failed for guild ${guildId}`, error);
            return null;
        }
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