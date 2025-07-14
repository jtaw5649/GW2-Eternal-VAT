const { Collection, MessageFlags } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

class CommandHandler {
    constructor(client) {
        this.client = client;
        this.commands = new Collection();
        this.devCommands = new Collection();
    }

    async loadCommands() {
        const commandsPath = path.join(__dirname, '..', 'commands');
        
        try {
            await fs.mkdir(commandsPath, { recursive: true });
            const commandFiles = await fs.readdir(commandsPath);
            
            for (const file of commandFiles) {
                if (!file.endsWith('.js')) continue;
                
                const command = require(path.join(commandsPath, file));
                if ('data' in command && 'execute' in command) {
                    this.commands.set(command.data.name, command);
                    this.client.logger.info(`Loaded command: ${command.data.name}`);
                }
            }
            
            const devPath = path.join(commandsPath, 'dev');
            if (await fs.access(devPath).then(() => true).catch(() => false)) {
                const devFiles = await fs.readdir(devPath);
                
                for (const file of devFiles) {
                    if (!file.endsWith('.js')) continue;
                    
                    const command = require(path.join(devPath, file));
                    if ('data' in command && 'execute' in command && command.isDev) {
                        this.devCommands.set(command.data.name, command);
                        this.client.logger.info(`Loaded dev command: ${command.data.name}`);
                    }
                }
            }
        } catch (error) {
            this.client.logger.error('Error loading commands', error);
        }
    }

    async handleInteraction(interaction) {
        if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu() || interaction.isUserSelectMenu()) {
            if (this.client.setupWizard && interaction.customId.startsWith('setup_')) {
                await this.client.setupWizard.handleInteraction(interaction);
                return;
            }
            
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith('devbackup_')) {
                const devbackupCommand = this.devCommands.get('devbackup');
                if (devbackupCommand && devbackupCommand.handleSelectMenu) {
                    try {
                        await devbackupCommand.handleSelectMenu(interaction, this.client);
                    } catch (error) {
                        this.client.logger.error('Error in devbackup handleSelectMenu', error, {
                            guild: interaction.guild,
                            user: interaction.user,
                            command: 'devbackup',
                            customId: interaction.customId
                        });
                        
                        try {
                            if (!interaction.replied && !interaction.deferred) {
                                await interaction.reply({
                                    content: '❌ An error occurred while processing your selection.',
                                    flags: MessageFlags.Ephemeral
                                });
                            } else {
                                await interaction.editReply({
                                    content: '❌ An error occurred while processing your selection.',
                                    embeds: [],
                                    components: []
                                });
                            }
                        } catch (replyError) {
                            this.client.logger.error('Failed to send error message', replyError, {
                                guild: interaction.guild,
                                user: interaction.user
                            });
                        }
                    }
                } else {
                    this.client.logger.warn('devbackup command not found or missing handleSelectMenu method', {
                        hasCommand: !!devbackupCommand,
                        hasMethod: !!(devbackupCommand && devbackupCommand.handleSelectMenu)
                    });
                }
                return;
            }
            
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith('devaudit_')) {
                const devauditCommand = this.devCommands.get('devaudit');
                if (devauditCommand && devauditCommand.handleSelectMenu) {
                    try {
                        await devauditCommand.handleSelectMenu(interaction, this.client);
                    } catch (error) {
                        this.client.logger.error('Error in devaudit handleSelectMenu', error);
                        await this.handleInteractionError(interaction, error);
                    }
                }
                return;
            }
            
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith('devreport_')) {
                const devreportCommand = this.devCommands.get('devreport');
                if (devreportCommand && devreportCommand.handleSelectMenu) {
                    try {
                        await devreportCommand.handleSelectMenu(interaction, this.client);
                    } catch (error) {
                        this.client.logger.error('Error in devreport handleSelectMenu', error);
                        await this.handleInteractionError(interaction, error);
                    }
                }
                return;
            }
        }
        
        if (!interaction.isChatInputCommand()) return;
        
        const command = this.commands.get(interaction.commandName) || this.devCommands.get(interaction.commandName);
        if (!command) return;
        
        try {
            this.client.logger.command(interaction.commandName, interaction.user, interaction.guild);
            await command.execute(interaction, this.client);
        } catch (error) {
            this.client.logger.error(`Error executing command ${interaction.commandName}`, error, {
                guild: interaction.guild,
                command: interaction.commandName,
                user: interaction.user
            });
            
            const errorMessage = 'There was an error executing this command';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
            }
        }
    }

    async handleInteractionError(interaction, error) {
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ An error occurred while processing your selection.',
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.editReply({
                    content: '❌ An error occurred while processing your selection.',
                    embeds: [],
                    components: []
                });
            }
        } catch (replyError) {
            this.client.logger.error('Failed to send error message', replyError);
        }
    }
}

module.exports = CommandHandler;