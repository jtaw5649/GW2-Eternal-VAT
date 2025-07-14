const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('devbackup')
        .setDescription('Developer: Backup management')
        .addSubcommand(subcommand =>
            subcommand
                .setName('trigger')
                .setDescription('Manually trigger a backup'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('restore')
                .setDescription('Restore from a previous backup'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('upload')
                .setDescription('Restore from uploaded backup file')
                .addAttachmentOption(option =>
                    option.setName('file')
                        .setDescription('Backup JSON file')
                        .setRequired(true)))
        .setDMPermission(false),
    
    isDev: true,
    
    async execute(interaction, client) {
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Access Denied')
                .setDescription('This command is restricted to the bot developer.')
                .setColor(0xFF0000)
                .setTimestamp();
                
            return interaction.reply({ 
                embeds: [embed], 
                flags: MessageFlags.Ephemeral 
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'trigger') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            try {
                const result = await client.backupHandler.performBackup();
                
                if (!result || !result.success) {
                    throw new Error(result?.error || 'Unknown error');
                }
                
                const backupPath = './backups';
                
                if (result.count === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('📦 Backup Complete')
                        .setDescription('No data to backup - no guilds have voice sessions.')
                        .setColor(0xFF9900)
                        .setTimestamp()
                        .addFields({
                            name: '💡 Info',
                            value: 'Voice sessions will be backed up once users start using voice channels.'
                        });
                        
                    await interaction.editReply({ embeds: [embed] });
                    return;
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Backup Complete')
                    .setDescription('Manual backup has been completed successfully!')
                    .setColor(0x00FF88)
                    .setTimestamp()
                    .addFields(
                        {
                            name: '📁 Backup Location',
                            value: `\`${backupPath}\``
                        },
                        {
                            name: '📊 Guilds Backed Up',
                            value: `${result.count} servers`
                        },
                        {
                            name: '📅 Next Scheduled',
                            value: 'Daily at 3 AM UTC'
                        }
                    );
                    
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Backup Failed')
                    .setDescription('An error occurred during the backup process.')
                    .setColor(0xFF0000)
                    .setTimestamp()
                    .addFields({
                        name: '⚠️ Error',
                        value: `\`\`\`${error.message}\`\`\``
                    });
                    
                await interaction.editReply({ embeds: [embed] });
            }
        } else if (subcommand === 'restore') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            try {
                const directories = await client.backupHandler.getAllBackupServers();
                
                if (directories.length === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('📁 No Backups Found')
                        .setDescription('No backup folders found.')
                        .setColor(0xFF9900)
                        .setTimestamp()
                        .addFields({
                            name: '💡 Suggestion',
                            value: 'Backups are created daily at 3 AM UTC. You can also trigger a manual backup using `/devbackup trigger`.'
                        });
                        
                    return interaction.editReply({ embeds: [embed] });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('📁 Select Server to Restore')
                    .setDescription('Choose which server\'s backup you want to restore.')
                    .setColor(0x0099FF)
                    .setTimestamp()
                    .addFields({
                        name: '🗂️ Available Backups',
                        value: `Found backups for ${directories.length} server(s)`
                    });
                
                const options = directories.slice(0, 25).map(dir => ({
                    label: dir.guildName,
                    description: `Last backup: ${dir.lastBackup || 'Unknown'}`,
                    value: dir.guildId
                }));
                
                const row = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`devbackup_selectserver_${interaction.user.id}`)
                            .setPlaceholder('Select a server')
                            .addOptions(options)
                    );
                
                await interaction.editReply({ embeds: [embed], components: [row] });
            } catch (error) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Error')
                    .setDescription('Failed to retrieve backup list.')
                    .setColor(0xFF0000)
                    .setTimestamp();
                    
                await interaction.editReply({ embeds: [embed] });
            }
        } else if (subcommand === 'upload') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const attachment = interaction.options.getAttachment('file');
            
            if (!attachment.name.endsWith('.json')) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Invalid File Type')
                    .setDescription('Please upload a JSON backup file.')
                    .setColor(0xFF0000)
                    .setTimestamp()
                    .addFields({
                        name: '📁 Expected Format',
                        value: 'Backup files must be in JSON format (`.json` extension)'
                    });
                    
                return interaction.editReply({ embeds: [embed] });
            }

            try {
                const response = await fetch(attachment.url);
                const fileContent = await response.text();
                
                const result = await client.backupHandler.restoreBackup(fileContent);
                
                if (result.success) {
                    const embed = new EmbedBuilder()
                        .setTitle('✅ Restore Complete')
                        .setDescription('Backup data has been successfully restored!')
                        .setColor(0x00FF88)
                        .setTimestamp()
                        .addFields(
                            {
                                name: '📊 Sessions Restored',
                                value: `${result.restoredCount} voice sessions`,
                                inline: true
                            },
                            {
                                name: '📁 Source File',
                                value: attachment.name,
                                inline: true
                            }
                        );
                        
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('❌ Restore Failed')
                        .setDescription('Failed to restore backup data.')
                        .setColor(0xFF0000)
                        .setTimestamp()
                        .addFields({
                            name: '⚠️ Error Details',
                            value: `\`\`\`${result.error}\`\`\``
                        });
                        
                    await interaction.editReply({ embeds: [embed] });
                }
            } catch (error) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Processing Error')
                    .setDescription('Failed to process the backup file.')
                    .setColor(0xFF0000)
                    .setTimestamp()
                    .addFields({
                        name: '🔧 Troubleshooting',
                        value: '• Ensure the file is a valid backup JSON\n• Check that the file is not corrupted\n• Verify the file size is under Discord limits'
                    });
                    
                await interaction.editReply({ embeds: [embed] });
            }
        }
    },
    
    async handleSelectMenu(interaction, client) {
        const [action, type, ...params] = interaction.customId.split('_');
        
        if (action !== 'devbackup') return false;
        
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            await interaction.reply({
                content: '❌ Unauthorized',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        
        try {
            await interaction.deferUpdate();
            
            if (type === 'selectserver') {
                const selectedGuildId = interaction.values[0];
                const backups = await client.backupHandler.getAvailableBackups(selectedGuildId);
                
                if (backups.length === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('📁 No Backups Found')
                        .setDescription(`No backup files found for the selected server.`)
                        .setColor(0xFF9900)
                        .setTimestamp()
                        .addFields({
                            name: '🆔 Guild ID',
                            value: `\`${selectedGuildId}\``
                        });
                        
                    await interaction.editReply({ embeds: [embed], components: [] });
                    return true;
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('📁 Select Backup to Restore')
                    .setDescription(`Choose a backup file for **${backups[0].guildName}**.`)
                    .setColor(0x0099FF)
                    .setTimestamp()
                    .addFields(
                        {
                            name: '🆔 Guild ID',
                            value: `\`${selectedGuildId}\``,
                            inline: true
                        },
                        {
                            name: '⚠️ Warning',
                            value: 'Restoring will merge the backup data with existing data for this guild.',
                            inline: false
                        }
                    );
                
                const options = backups.slice(0, 25).map(backup => ({
                    label: backup.date,
                    description: `${(backup.size / 1024).toFixed(1)} KB`,
                    value: backup.filename
                }));
                
                const row = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`devbackup_select_${selectedGuildId}`)
                            .setPlaceholder('Select a backup date')
                            .addOptions(options)
                    );
                
                await interaction.editReply({ embeds: [embed], components: [row] });
            } else if (type === 'select') {
                const guildId = params[0];
                const filename = interaction.values[0];
                const result = await client.backupHandler.restoreFromFile(guildId, filename);
                
                if (result.success) {
                    const backups = await client.backupHandler.getAvailableBackups(guildId);
                    const guildName = backups.length > 0 ? backups[0].guildName : 'Unknown';
                    
                    const embed = new EmbedBuilder()
                        .setTitle('✅ Restore Complete')
                        .setDescription(`Backup data has been successfully restored for **${guildName}**!`)
                        .setColor(0x00FF88)
                        .setTimestamp()
                        .addFields(
                            {
                                name: '🆔 Guild ID',
                                value: `\`${guildId}\``,
                                inline: true
                            },
                            {
                                name: '📊 Sessions Restored',
                                value: `${result.restoredCount} voice sessions`,
                                inline: true
                            },
                            {
                                name: '📅 Backup Date',
                                value: filename.replace('backup-', '').replace('.json', ''),
                                inline: true
                            }
                        );
                        
                    await interaction.editReply({ embeds: [embed], components: [] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('❌ Restore Failed')
                        .setDescription('Failed to restore backup data.')
                        .setColor(0xFF0000)
                        .setTimestamp()
                        .addFields({
                            name: '⚠️ Error Details',
                            value: `\`\`\`${result.error}\`\`\``
                        });
                        
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
            }
        } catch (error) {
            client.logger.error('Error in devbackup handleSelectMenu', error, {
                guild: interaction.guild,
                user: interaction.user,
                command: 'devbackup',
                type: type,
                params: params,
                customId: interaction.customId
            });
            
            const embed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('An unexpected error occurred while processing your selection.')
                .setColor(0xFF0000)
                .setTimestamp()
                .addFields({
                    name: '🔧 Error Details',
                    value: `\`\`\`${error.message}\`\`\``
                });
                
            try {
                await interaction.editReply({ embeds: [embed], components: [] });
            } catch (editError) {
                client.logger.error('Failed to edit reply', editError, {
                    guild: interaction.guild,
                    user: interaction.user
                });
            }
        }
        
        return true;
    }
};