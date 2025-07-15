const { createTestInteraction } = require('../../setup');

describe('Config Command', () => {
    let mockInteraction;
    let mockClient;
    let configCommand;
    
    beforeEach(() => {
        mockInteraction = createTestInteraction('config', { subcommand: 'view' });
        mockClient = {
            prisma: {
                serverConfig: {
                    findUnique: jest.fn(),
                    update: jest.fn()
                }
            },
            redis: {
                keys: jest.fn().mockResolvedValue([]),
                zcard: jest.fn().mockResolvedValue(0)
            },
            configManager: {
                clearCache: jest.fn()
            },
            scheduledTasks: new Map()
        };
        
        configCommand = require('../../../src/commands/config');
    });
    
    describe('view subcommand', () => {
        test('shows configuration when exists', async () => {
            const mockConfig = {
                guildId: '1234567890',
                trackingRoleName: 'Voice Active',
                commandRoleId: '111',
                reportChannelId: '222',
                reportRecipients: ['333', 'c:444'],
                excludedChannelIds: ['555', '666'],
                minSessionMinutes: 20,
                rejoinWindowMinutes: 20,
                weeklyReportEnabled: true,
                weeklyReportDay: 0,
                weeklyReportHour: 9,
                updatedAt: new Date()
            };
            
            mockClient.prisma.serverConfig.findUnique.mockResolvedValue(mockConfig);
            
            await configCommand.execute(mockInteraction, mockClient);
            
            expect(mockInteraction.editReply).toHaveBeenCalled();
            const call = mockInteraction.editReply.mock.calls[0][0];
            
            expect(call.embeds).toBeDefined();
            expect(Array.isArray(call.embeds)).toBe(true);
            expect(call.embeds.length).toBeGreaterThan(0);
            
            const embed = call.embeds[0];
            const embedData = embed.data || embed;
            
            expect(embedData.title).toBe('📋 Server Configuration');
            
            expect(embedData.fields).toBeDefined();
            expect(Array.isArray(embedData.fields)).toBe(true);
            
            const trackingField = embedData.fields.find(f => f.name === '🎯 Tracking Settings');
            expect(trackingField).toBeDefined();
            expect(trackingField.value).toContain('Voice Active');
            expect(trackingField.value).toContain('<#555>');
            expect(trackingField.value).toContain('<#666>');
            
            const reportField = embedData.fields.find(f => f.name === '📊 Report Settings');
            expect(reportField).toBeDefined();
            expect(reportField.value).toContain('<#444>');
            expect(reportField.value).toContain('<@333>');
        });
        
        test('shows error when not configured', async () => {
            mockClient.prisma.serverConfig.findUnique.mockResolvedValue(null);
            
            await configCommand.execute(mockInteraction, mockClient);
            
            expect(mockInteraction.editReply).toHaveBeenCalled();
            const call = mockInteraction.editReply.mock.calls[0][0];
            
            expect(call.embeds).toBeDefined();
            expect(Array.isArray(call.embeds)).toBe(true);
            expect(call.embeds.length).toBeGreaterThan(0);
            
            const embed = call.embeds[0];
            const embedData = embed.data || embed;
            
            expect(embedData.title).toBe('❌ Not Configured');
            expect(embedData.description).toContain('This server has not been configured yet');
        });
    });
    
    describe('reset subcommand', () => {
        beforeEach(() => {
            mockInteraction.options.getSubcommand = jest.fn().mockReturnValue('reset');
            mockInteraction.reply = jest.fn().mockResolvedValue({
                awaitMessageComponent: jest.fn()
            });
        });
        
        test('resets configuration on confirm', async () => {
            const mockResponse = {
                awaitMessageComponent: jest.fn().mockResolvedValue({
                    customId: 'confirm_reset',
                    update: jest.fn()
                })
            };
            
            mockInteraction.reply.mockResolvedValue(mockResponse);
            
            await configCommand.execute(mockInteraction, mockClient);
            
            expect(mockClient.prisma.serverConfig.update).toHaveBeenCalledWith({
                where: { guildId: '1234567890' },
                data: expect.objectContaining({
                    trackingRoleName: 'Voice Active',
                    excludedChannelIds: []
                })
            });
        });
    });
});