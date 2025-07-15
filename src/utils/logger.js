const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { EmbedBuilder, WebhookClient } = require('discord.js');
const path = require('path');

class Logger {
    constructor(client, redis) {
        this.client = client;
        this.redis = redis;
        this.webhookUrl = process.env.LOG_WEBHOOK_URL;
        
        if (this.webhookUrl) {
            const match = this.webhookUrl.match(/discord\.com\/api\/webhooks\/(\d+)\/(.+)/);
            if (match) {
                this.webhookClient = new WebhookClient({ id: match[1], token: match[2] });
            }
        }
        
        const logFormat = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            winston.format.errors({ stack: true }),
            winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                let log = `[${timestamp}]`;
                
                if (this.client.shard) {
                    log += ` [SHARD ${this.client.shard.ids[0]}]`;
                }
                
                log += ` ${level.toUpperCase()}: ${message}`;
                
                if (stack) {
                    const cleanStack = this.formatStackTrace(stack);
                    log += `\n${cleanStack}`;
                }
                
                if (Object.keys(meta).length) {
                    log += ` ${JSON.stringify(meta, null, 2)}`;
                }
                
                return log;
            })
        );

        const consoleFormat = winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
            winston.format.printf(({ timestamp, level, message }) => {
                let prefix = `[${timestamp}]`;
                if (this.client.shard) {
                    prefix += ` [S${this.client.shard.ids[0]}]`;
                }
                return `${prefix} ${level}: ${message}`;
            })
        );

        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: logFormat,
            transports: [
                new winston.transports.Console({
                    format: consoleFormat
                }),
                new DailyRotateFile({
                    filename: path.join('/logs', '%DATE%-bot.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: '20m',
                    maxFiles: '14d',
                    format: logFormat
                }),
                new DailyRotateFile({
                    filename: path.join('/logs', '%DATE%-error.log'),
                    datePattern: 'YYYY-MM-DD',
                    level: 'error',
                    maxSize: '20m',
                    maxFiles: '30d',
                    format: logFormat
                })
            ]
        });

        this.setupErrorHandler();
    }

    setupErrorHandler() {
        this.logger.on('error', (error) => {
            console.error('Logger error:', error);
        });
    }

    formatStackTrace(stack) {
        return stack
            .split('\n')
            .map(line => {
                if (line.includes('node_modules')) {
                    return `    ${line.trim()} [external]`;
                }
                return `  > ${line.trim()}`;
            })
            .join('\n');
    }

    categorizeDiscordError(error) {
        if (!error.code) return 'UNKNOWN';
        
        const errorCategories = {
            401: 'UNAUTHORIZED',
            403: 'FORBIDDEN',
            429: 'RATE_LIMITED',
            50001: 'MISSING_ACCESS',
            50013: 'MISSING_PERMISSIONS',
            50035: 'INVALID_FORM_BODY',
            10003: 'UNKNOWN_CHANNEL',
            10004: 'UNKNOWN_GUILD',
            10007: 'UNKNOWN_MEMBER',
            10008: 'UNKNOWN_MESSAGE',
            10011: 'UNKNOWN_ROLE',
            10062: 'UNKNOWN_INTERACTION',
            20012: 'ONLY_OWNER',
            30001: 'MAX_GUILDS',
            40001: 'UNAUTHORIZED_OAUTH2',
            50007: 'CANNOT_MESSAGE_USER',
            50025: 'INVALID_OAUTH2_STATE',
            50041: 'INVALID_OAUTH2_ACCESS'
        };
        
        return errorCategories[error.code] || `DISCORD_${error.code}`;
    }

    async sendErrorWebhook(error, context = {}) {
        if (!this.webhookClient) return;

        try {
            const errorCategory = error.code ? this.categorizeDiscordError(error) : 'APPLICATION';
            
            const embed = new EmbedBuilder()
                .setTitle(`🚨 Bot Error [${errorCategory}]`)
                .setColor(0xFF0000)
                .setTimestamp();

            if (this.client.shard) {
                embed.addFields({
                    name: '🔧 Shard',
                    value: `${this.client.shard.ids[0]}/${this.client.shard.count}`,
                    inline: true
                });
            }

            if (context.guild) {
                embed.addFields({
                    name: '📍 Guild',
                    value: `${context.guild.name} (${context.guild.id})`,
                    inline: true
                });
            }

            if (context.user) {
                embed.addFields({
                    name: '👤 User',
                    value: `${context.user.username} (${context.user.id})`,
                    inline: true
                });
            }

            if (context.command) {
                embed.addFields({
                    name: '⚡ Command',
                    value: `/${context.command}`,
                    inline: true
                });
            }

            const errorMessage = error.code 
                ? `Code: ${error.code}\n${error.message || error}`
                : error.message || error;
                
            embed.addFields({
                name: '❌ Error',
                value: `\`\`\`js\n${errorMessage.substring(0, 1000)}\`\`\``,
                inline: false
            });

            if (error.stack) {
                const stack = this.formatStackTrace(error.stack).substring(0, 1000);
                embed.addFields({
                    name: '📋 Stack Trace',
                    value: `\`\`\`${stack}\`\`\``,
                    inline: false
                });
            }

            await this.webhookClient.send({
                username: `${this.client.user.username}`,
                avatarURL: this.client.user.displayAvatarURL(),
                embeds: [embed]
            });
        } catch (error) {
            this.logger.error('Failed to send error webhook', { error: error.message });
        }
    }

    log(level, message, meta = {}) {
        const enhancedMeta = { ...meta };
        
        if (meta.guild && typeof meta.guild === 'object') {
            message = `[${meta.guild.name}] ${message}`;
            enhancedMeta.guildId = meta.guild.id;
            delete enhancedMeta.guild;
        }
        
        if (meta.user && typeof meta.user === 'object') {
            enhancedMeta.userId = meta.user.id;
            enhancedMeta.username = meta.user.username;
            delete enhancedMeta.user;
        }
        
        this.logger.log(level, message, enhancedMeta);
    }

    info(message, meta = {}) {
        this.log('info', message, meta);
    }

    warn(message, meta = {}) {
        this.log('warn', message, meta);
    }

    error(message, error = null, context = {}) {
        const errorMeta = { ...context };
        
        if (error) {
            errorMeta.error = error.message || error.toString();
            errorMeta.stack = error.stack || null;
            errorMeta.code = error.code || null;
            
            this.log('error', message, errorMeta);
            
            if (!error.message) {
                error = new Error(error.toString());
            }
            this.sendErrorWebhook(error, context);
        } else {
            this.log('error', message, errorMeta);
        }
    }

    debug(message, meta = {}) {
        this.log('debug', message, meta);
    }

    voice(action, member, guild) {
        const meta = {
            guild,
            user: member.user,
            userId: member.id,
            action
        };
        
        this.info(`${member.displayName} ${action} voice`, meta);
    }

    command(commandName, user, guild) {
        const meta = {
            guild,
            user,
            userId: user.id,
            command: commandName
        };
        
        this.info(`Command /${commandName} used by ${user.username}`, meta);
    }

    report(type, guild, days, recipients) {
        const meta = {
            guild,
            recipients: recipients.length,
            type,
            days
        };
        
        this.info(`${type} report generated for ${days} days`, meta);
    }
}

module.exports = Logger;