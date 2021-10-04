import type {
    GuildMember,
    Interaction,
    StageChannel,
    VoiceChannel,
} from "discord.js";
import { config } from "dotenv";
import { Client, Intents } from "discord.js";
import { PrismaClient } from "@prisma/client";

import express from "express";
import { play, skip, stop } from "./musicBot";

config();

const { BOT_TOKEN, HEROKU_RELEASE_VERSION, PORT } = process.env;
const admin_id = "198976694558785537";
const prisma = new PrismaClient();

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_VOICE_STATES,
        Intents.FLAGS.GUILD_PRESENCES,
        Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        Intents.FLAGS.GUILD_MESSAGE_TYPING,
    ],
});

client.once("ready", () => {
    console.log("Ready!");
    client.user?.setActivity(
        `Voice Chats${
            HEROKU_RELEASE_VERSION ? " : " + HEROKU_RELEASE_VERSION : ""
        }`,
        { type: "WATCHING" }
    );
});

client.on("voiceStateUpdate", async (oldMember, newMember) => {
    if (oldMember.member.user.bot) return;
    if (newMember.member.user.bot) return;

    const oldChannel = oldMember.channel;
    const newChannel = newMember.channel;

    if (newMember.mute !== oldMember.mute) {
        console.log("Toggled mute");
        await testLiveAndSet(newChannel);
    } else if (newMember.deaf !== oldMember.deaf) {
        console.log("Toggled deafen");
        await testLiveAndSet(newChannel);
    } else {
        // Channel changed
        if (!oldChannel && newChannel) {
            console.log("Joined new channel");
            await testLiveAndSet(newChannel);
        } else if (!newChannel && oldChannel) {
            console.log("Left channel");
            await testLiveAndSet(oldChannel);
        } else if (oldChannel && newChannel) {
            console.log("Switched channels");

            await testLiveAndSet(oldChannel);
            await testLiveAndSet(newChannel);
        }
    }
});

client.on("messageCreate", async (message) => {
    console.log(message.content);

    if (message.author.bot) return;
    if (message.channel.type === "DM") return;

    const prefix = "!";

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();
    console.log(command, args);

    if (command === "deploy" && message.author.id === admin_id) {
        await message.guild.commands.set([
            {
                name: "play",
                description: "Plays a song",
                options: [
                    {
                        name: "song",
                        type: "STRING" as const,
                        description: "The URL of the song to play",
                        required: true,
                    },
                ],
            },
            {
                name: "skip",
                description: "Skips the current song",
            },
            {
                name: "stop",
                description: "Stops the music",
            },
        ]);
        await message.reply("Deployed!");
    } else if (command === "play") {
        play(message);
    } else if (command === "skip") {
        skip(message);
    } else if (command === "stop") {
        stop(message);
    }
});

client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isCommand() || !interaction.guildId) return;

    if (interaction.commandName === "play") {
        await interaction.deferReply();
        await play(interaction);
    }
    if (interaction.commandName === "skip") {
        await interaction.deferReply();
        skip(interaction);
    }
    if (interaction.commandName === "stop") {
        await interaction.deferReply();
        stop(interaction);
    }
});

async function testLiveAndSet(channel: VoiceChannel | StageChannel) {
    const live = await checkLiveStatuses(channel);
    console.log(live);
    if (live) {
        await setLiveChannel(channel);
    } else {
        await setNotLiveChannel(channel);
    }
}

async function checkLiveStatuses(channel: VoiceChannel | StageChannel) {
    return new Promise((resolve, reject) => {
        for (const member of channel.members.map((m) => m as GuildMember)) {
            if (member.user.bot) continue;

            // console.log(member.presence);
            if (!member.presence) continue;
            if (!member.presence.activities) continue;

            for (const activity of member.presence.activities) {
                // console.log("User Activity:");
                // console.log(activity.type);
                if (member.user.id === admin_id) {
                    if (activity.type === "CUSTOM") {
                        // console.log(activity);
                        if (activity.state === "LIVE_TEST") {
                            return resolve(true);
                        }
                    }
                }
                if (activity.type === "STREAMING" && activity.url) {
                    // Check only activity status currently.
                    return resolve(true);
                }
            } // forEach activity
        } // forEach member
        return resolve(false);
    }); // Promise
}

async function setLiveChannel(channel: VoiceChannel | StageChannel) {
    const channelDb = await prisma.channel.findFirst({
        where: { channelId: channel.id },
    });

    if (channelDb && channelDb.live) return;

    let name = "";
    if (channelDb && channelDb.name) {
        name = await channelDb.name;
    } else {
        name = channel.name;
    }

    console.log("Channel Name: ", name);

    const newData = await prisma.channel.upsert({
        where: { channelId: channel.id },
        create: {
            channelId: channel.id,
            name: channel.name,
            guildId: channel.guild.id,
            live: true,
        },
        update: { live: true },
    });

    console.log(`Changing Channel name to: 🔴[LIVE] ${name}`);
    await channel.setName(`🔴[LIVE] ${name}`);
}

async function setNotLiveChannel(channel: VoiceChannel | StageChannel) {
    const channelDb = await prisma.channel.findFirst({
        where: { channelId: channel.id },
    });

    if (channelDb && !channelDb.live) return;

    let name = null;
    if (channelDb && channelDb.name) {
        name = channelDb.name;
    }

    console.log("Channel Name: ", name);

    await prisma.channel.upsert({
        where: { channelId: channel.id },
        create: {
            channelId: channel.id,
            name: channel.name,
            guildId: channel.guild.id,
            live: false,
        },
        update: { live: false },
    });

    if (name) {
        console.log(`Changing Channel name to: ${name}`);
        await channel.setName(`${name}`);
    }
}

client.login(BOT_TOKEN);

const app = express();

app.get("/", (req, res) => {
    res.send("Vibe tribeee");
});

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});
