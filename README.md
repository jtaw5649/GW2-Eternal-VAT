# **GW2 Eternal Voice Activity Tracking**
**Version:** 0.1.0

## **What This Bot Does**
This bot tracks voice channel activity for members with a configurable tracking role using PostgreSQL and Redis.

### **Key Features**
• **Role-Based Tracking**: Tracks members who have the configured tracking role (default: "Voice Active")
• **Channel Exclusion**: Can exclude specific voice channels from tracking (e.g., AFK channels)
• **Minimum Session Duration**: Only counts voice sessions lasting 20+ minutes (configurable)
• **Session Rejoining**: Smart session continuation with two grace periods:
  - **Completed sessions (20+ minutes)**: If someone disconnects and rejoins within 20 minutes, it continues their previous session
  - **Short sessions (under 20 minutes)**: Held as "pending" for 5 minutes - if they rejoin quickly, the session continues; otherwise it's discarded
• **Database Storage**: Uses PostgreSQL for configuration and Redis for active session tracking
• **Automated Reports**: Sends weekly activity summaries via scheduled reports
• **Multi-Server Support**: Can track multiple Discord servers independently
• **Session Recovery**: Handles bot restarts gracefully, resuming active sessions
• **Daily Backups**: Automated daily backups of all session data sent via webhook at 3 AM UTC

## **Slash Commands**

### **/setup** - Interactive Setup Wizard
• **Usage**: `/setup`
• **Access**: Server administrators only
• **Description**: Launches an interactive setup wizard that guides you through configuration
• **Wizard Steps**:
  1. **Tracking Role** - Select the role to track for voice activity
  2. **Report Recipients** - Choose channels and users to receive reports
  3. **Command Permissions** - Configure who can use commands and where
  4. **Excluded Channels** - Select voice channels to exclude from tracking
  5. **Weekly Reports** - Enable or disable automated weekly reports
  6. **Timezone** - Select your server's timezone for accurate scheduling
  7. **Review & Confirm** - Review all settings before applying

### **/config** - View or Reset Configuration
• **Usage**: `/config`
• **Access**: Server administrators or users with Manage Guild permission
• **Shows**: Interactive menu with options to:
  - **View Config**: See all current settings, statistics, and configuration
  - **Reset Config**: Reset everything to default values (requires confirmation)

### **/voicereport** - Generate Activity Report
• **Usage**: `/voicereport days:7`
• **Access**: Administrators, Manage Guild permission, or configured command role
• **Options**: 7, 14, 21, or 30 day reports

### **/help** - Get Help
• **Usage**: `/help`
• **Access**: Server administrators only
• **Shows**: Command information and quick start guide

## **How It Works**

### **Voice Tracking System**
1. When a member with the tracking role joins a non-excluded voice channel, the bot creates a session:
   ```js
   async startSession(guildId, userId, displayName) {
     const sessionData = {
       startTime: Date.now(),
       totalTime: 0,
       displayName,
       userId,
       guildId
     };
     await redis.setex(
       `voice:${guildId}:active:${userId}`,
       24 * 60 * 60, // 24h TTL
       JSON.stringify(sessionData)
     );
   }
   ```

2. When they leave or move to an excluded channel, it saves the completed session:
   ```js
   await redis.zadd(
     `voice:${guildId}:completed`,
     Date.now(),
     JSON.stringify(completedSession)
   );
   ```

3. Sessions under the minimum duration (default: 20 minutes) are stored as "pending" for 5 minutes
   - If the user rejoins within 5 minutes, their session continues from where it left off
   - Otherwise, the pending session is discarded
4. Sessions 20+ minutes long that end are saved as "completed"
   - If they rejoin within the rejoin window (default: 20 minutes), the bot resumes with their previous time included
5. Excluded channels are completely ignored

**Example scenarios:**
- User in voice for 15 minutes → leaves → rejoins in 3 minutes = Session continues (pending system)
- User in voice for 15 minutes → leaves → rejoins in 10 minutes = New session starts (pending expired)
- User in voice for 45 minutes → leaves → rejoins in 15 minutes = Previous 45 minutes added to new session
- User in voice for 45 minutes → leaves → rejoins in 25 minutes = New session starts (rejoin window expired)

### **Data Storage**

#### **PostgreSQL - Configuration**
• **Server Settings**: Tracking role, report recipients, excluded channels
• **Report Logs**: History of generated reports
• **Session Archives**: Long-term session data (optional)

#### **Redis - Active Tracking**
• **Active Sessions**: Current voice sessions with 24-hour TTL
  ```
  key: "voice:guildId:active:userId"
  value: {"startTime": 1704470400000, "totalTime": 0, "displayName": "John", "userId": "123", "guildId": "456"}
  ```
• **Pending Sessions**: Sessions under minimum duration with 5-minute TTL
  ```
  key: "voice:guildId:pending:userId"
  value: {"startTime": 1704470400000, "totalTime": 900000, "endTime": 1704471300000, "displayName": "John", "userId": "123", "guildId": "456"}
  ```
• **Completed Sessions**: Recent sessions in sorted sets
  ```
  key: "voice:guildId:completed"
  member: {"userId": "123", "displayName": "John", "totalTime": 3600000, "timestamp": 1704474000000}
  ```
• **Configuration Cache**: Cached settings for performance

### **What's Tracked**
• User Display Name
• Total Time in voice (excluding excluded channels)
• Session Timestamps
• Guild-specific data isolation

### **What's NOT Tracked**
• Voice content or conversations
• Screen sharing or video status
• Specific voice channel names (only duration)
• Users without the tracking role
• Bot accounts
• Time in excluded channels

## **Reports**

### **Weekly Report (Configurable Day/Time)**
Default: Every Sunday at 9 AM
Shows activity for the past 7 days:

```
📊 Weekly Voice Activity Report

Server: PEST | Please Excuse the Silly Tactics
Tracking Role: PEST
Period: Last 7 days

📈 Statistics
Active: 5 (63%)
Inactive: 3 (37%)
Total: 8

✅ Active Users (5)
John Doe - 12h 30m
Jane Smith - 8h 45m
Bob Wilson - 6h 15m
Alice Brown - 4h 20m
Charlie Davis - 2h 10m

❌ Inactive Users (3)
David Miller, Emma Jones, Frank Taylor
```

### **Manual Reports**
Generate reports on-demand using `/voicereport` for 7, 14, 21, or 30 day periods.

## **Setup Process**

1. **Invite Bot**: Use the OAuth2 URL with required permissions
2. **Launch Setup Wizard**: Run `/setup` to start the interactive configuration:
   - Follow the 7-step wizard to configure all settings
   - Each step has clear instructions and options
   - You can go back to previous steps if needed
3. **Verify Settings**: Use `/config` to check configuration
4. **Test**: Generate a manual report with `/voicereport`

## **Required Bot Permissions**
• **View Channels**: See voice channels and member information
• **Send Messages**: Send reports to channels
• **Embed Links**: Send formatted embeds
• **Use Slash Commands**: Register and respond to commands
• **Read Message History**: Proper functionality

## **Privacy & Data**

### **Data Retention**
• Active sessions: 24-hour expiry in Redis
• Completed sessions: 60-day automatic cleanup
• Configuration: Persistent in PostgreSQL
• No voice content is ever recorded

### **Data Isolation**
Each Discord server's data is completely isolated:
- Separate Redis namespaces per guild
- Separate database records per guild
- No cross-server data access

### **Automated Backups**
• **Schedule**: Daily at 3 AM UTC
• **Content**: All completed sessions and server configurations
• **Destination**: Sent via webhook as JSON attachments
• **Format**: Split into multiple files if needed (8MB limit per file)
• **Purpose**: Data recovery and archival

## **Configuration Options**

### **Tracking Settings**
- **Tracking Role**: Which role to monitor
- **Excluded Channels**: Voice channels to ignore
- **Min Session Duration**: Minimum time to count (default: 20 min)
- **Rejoin Window**: Time to resume completed sessions (default: 20 min)
- **Pending Window**: Time to hold short sessions (fixed: 5 min)

### **Report Settings**
- **Report Recipients**: Channels and users to receive reports
- **Weekly Reports**: Enable/disable automated reports
- **Report Day/Time**: When to send weekly reports
- **Timezone**: Server timezone for accurate report scheduling

### **Permission Settings**
- **Command Role**: Additional role that can use commands
- **Command Channel**: Restrict commands to specific channel

## **Troubleshooting**

### **Bot Not Tracking**
1. Check tracking role exists: `/config`
2. Verify members have the role
3. Check if in excluded channel
4. Ensure bot has permissions

### **Reports Not Sending**
1. Verify report recipients configured
2. Check bot can message the channel/user
3. Review report settings: `/config`

### **Commands Not Working**
1. Ensure you have required permissions
2. Check if in correct channel (if restricted)
3. Wait a moment for commands to register after bot joins

## **Support**
For issues or questions, contact the bot developer:
- Discord: jtaw.5649
- GitLab: https://gitlab.com/jtaw

## **License**
© 2025 jtaw. All Rights Reserved.

This code is published for portfolio/demonstration purposes only. No permission is granted to use, copy, modify, or distribute this software for any purpose.