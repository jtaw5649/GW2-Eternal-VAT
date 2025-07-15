const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis-mock');
const { Client } = require('discord.js');

jest.mock('discord.js', () => {
    const actual = jest.requireActual('discord.js');
    return {
        ...actual,
        Client: jest.fn().mockImplementation(() => ({
            user: { tag: 'TestBot#0000', id: '123456789' },
            guilds: {
                cache: new Map(),
                fetch: jest.fn()
            },
            channels: {
                cache: new Map(),
                fetch: jest.fn()
            },
            users: {
                cache: new Map(),
                fetch: jest.fn()
            },
            on: jest.fn(),
            once: jest.fn(),
            login: jest.fn().mockResolvedValue(true),
            destroy: jest.fn()
        }))
    };
});

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/voice_monitor_test';

const createTestGuild = (id = '1234567890') => ({
    id,
    name: 'Test Guild',
    members: {
        cache: new Map(),
        fetch: jest.fn(),
        me: { permissions: { has: jest.fn().mockReturnValue(true) } }
    },
    roles: {
        cache: {
            find: jest.fn((predicate) => {
                const roles = [
                    { id: '987654321', name: 'Voice Active' }
                ];
                return roles.find(predicate);
            }),
            set: jest.fn(),
            get: jest.fn(),
            has: jest.fn()
        }
    },
    channels: {
        cache: new Map()
    },
    commands: {
        set: jest.fn().mockResolvedValue(true)
    },
    iconURL: jest.fn().mockReturnValue('https://example.com/icon.png')
});

const createTestMember = (userId = '111111111', roleIds = []) => ({
    id: userId,
    user: {
        id: userId,
        bot: false,
        username: 'TestUser',
        tag: 'TestUser#0001'
    },
    displayName: 'TestUser',
    roles: {
        cache: new Map(roleIds.map(id => [id, { id }]))
    },
    voice: {
        channel: null
    }
});

const createTestInteraction = (commandName, options = {}) => ({
    commandName,
    guildId: '1234567890',
    guild: createTestGuild(),
    member: createTestMember('111111111', ['987654321']),
    options: {
        getSubcommand: jest.fn().mockReturnValue(options.subcommand),
        getRole: jest.fn().mockReturnValue(options.role),
        getChannel: jest.fn().mockReturnValue(options.channel),
        getUser: jest.fn().mockReturnValue(options.user),
        getBoolean: jest.fn().mockReturnValue(options.boolean),
        getInteger: jest.fn().mockReturnValue(options.integer)
    },
    deferReply: jest.fn().mockResolvedValue(true),
    reply: jest.fn().mockResolvedValue(true),
    editReply: jest.fn().mockResolvedValue(true),
    followUp: jest.fn().mockResolvedValue(true),
    isChatInputCommand: jest.fn().mockReturnValue(true)
});

const cleanDatabase = async (prisma) => {
    const tables = ['VoiceSession', 'ReportLog', 'ServerConfig'];
    for (const table of tables) {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    }
};

module.exports = {
    Redis,
    createTestGuild,
    createTestMember,
    createTestInteraction,
    cleanDatabase
};