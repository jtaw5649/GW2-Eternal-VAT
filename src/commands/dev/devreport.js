const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('devreport')
        .setDescription('Developer: Generate report for any server')
        .setDMPermission(false),
    
    isDev: true,
    
    async execute(interaction, client) {
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            return interaction.reply({ 
                content: 'This command is restricted to the bot developer.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const guilds = Array.from(client.guilds.cache.values())
            .sort((a, b) => b.memberCount - a.memberCount)
            .slice(0, 25);
        
        if (guilds.length === 0) {
            return interaction.editReply('No servers found.');
        }

        const options = guilds.map(guild => ({
            label: guild.name.substring(0, 100),
            description: `${guild.memberCount} members`,
            value: guild.id
        }));

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('devreport_guild')
                    .setPlaceholder('Select a server')
                    .addOptions(options)
            );

        const embed = new EmbedBuilder()
            .setTitle('🔧 Developer Report Generator')
            .setDescription('Select a server to generate a report')
            .setColor(0xFF0088)
            .setTimestamp();

        await interaction.editReply({ 
            embeds: [embed], 
            components: [row] 
        });
    },

    async handleSelectMenu(interaction, client) {
        const [action, type, ...params] = interaction.customId.split('_');
        
        if (action !== 'devreport') return false;
        
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            await interaction.reply({
                content: '❌ Unauthorized',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        
        try {
            await interaction.deferUpdate();
            
            if (type === 'guild') {
                const selectedGuildId = interaction.values[0];
                const selectedGuild = client.guilds.cache.get(selectedGuildId);
                
                if (!selectedGuild) {
                    await interaction.editReply({ 
                        content: 'Server not found.', 
                        embeds: [], 
                        components: [] 
                    });
                    return true;
                }

                const daysRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`devreport_days_${selectedGuildId}`)
                            .setPlaceholder('Select report period')
                            .addOptions([
                                { label: '7 days', value: '7' },
                                { label: '14 days', value: '14' },
                                { label: '21 days', value: '21' },
                                { label: '30 days', value: '30' }
                            ])
                    );

                const embed = new EmbedBuilder()
                    .setTitle('🔧 Developer Report Generator')
                    .setDescription(`Server: **${selectedGuild.name}**\n\nSelect the report period`)
                    .setColor(0xFF0088)
                    .setTimestamp();

                await interaction.editReply({ 
                    embeds: [embed], 
                    components: [daysRow] 
                });
                
            } else if (type === 'days') {
                const selectedGuildId = params[0];
                const days = parseInt(interaction.values[0]);
                const selectedGuild = client.guilds.cache.get(selectedGuildId);
                
                if (!selectedGuild) {
                    await interaction.editReply({ 
                        content: 'Server not found.', 
                        embeds: [], 
                        components: [] 
                    });
                    return true;
                }

                const config = await client.configManager.getServerConfig(selectedGuildId);
                
                if (!config) {
                    await interaction.editReply({ 
                        content: `Server "${selectedGuild.name}" is not configured.`, 
                        embeds: [], 
                        components: [] 
                    });
                    return true;
                }

                const report = await client.generateReport(selectedGuild, config, days);
                
                const infoEmbed = new EmbedBuilder()
                    .setTitle('📊 Developer Report Generated')
                    .setDescription(`Generated ${days}-day report for **${selectedGuild.name}**`)
                    .setColor(0x00FF88)
                    .setTimestamp()
                    .setThumbnail(selectedGuild.iconURL())
                    .addFields(
                        { name: 'Server ID', value: selectedGuildId, inline: true },
                        { name: 'Members', value: selectedGuild.memberCount.toString(), inline: true },
                        { name: 'Tracking Role', value: config.trackingRoleName, inline: true }
                    );

                await interaction.editReply({ 
                    embeds: [infoEmbed], 
                    components: [] 
                });

                await interaction.followUp({ 
                    embeds: [report]
                });
            }
        } catch (error) {
            client.logger.error('Error in devreport handleSelectMenu', error, {
                guild: interaction.guild,
                user: interaction.user,
                command: 'devreport',
                type: type,
                params: params
            });
            
            const embed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('An unexpected error occurred while generating the report.')
                .setColor(0xFF0000)
                .setTimestamp()
                .addFields({
                    name: '🔧 Error Details',
                    value: `\`\`\`${error.message}\`\`\``
                });
                
            try {
                await interaction.editReply({ embeds: [embed], components: [] });
            } catch (editError) {
                client.logger.error('Failed to edit reply', editError);
            }
        }
        
        return true;
    }
};