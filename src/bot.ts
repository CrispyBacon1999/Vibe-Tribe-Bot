import {
    GuildMember,
    Interaction,
    Message,
    MessageEmbed,
    StageChannel,
    TextBasedChannels,
    TextChannel,
    VoiceChannel,
    VoiceState,
} from "discord.js";
import { config } from "dotenv";
import { Client, Intents } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { Player, ProgressBar, RepeatMode, Song } from "discord-music-player";

import express from "express";
import { play, skip, stop } from "./musicBot";
import { getTwitchChannelFromUser, isChannelLive } from "./twitch";
import {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    getVoiceConnection,
    joinVoiceChannel,
} from "@discordjs/voice";

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
    client.user?.setActivity({
        name: "Nothing",
        type: "LISTENING",
    });
});

client.on("interactionCreate", async (interaction: Interaction) => {
    if (interaction.isCommand()) {
        const { commandName } = interaction;
        if (commandName === "play") {
        }
    }
});

client.on(
    "voiceStateUpdate",
    async (oldMember: VoiceState, newMember: VoiceState) => {
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
    }
);

let latestNowPlaying: Message = null;
let nowPlayingUnsub: NodeJS.Timer = null;

const sendDelete = async (
    channel: TextBasedChannels,
    message: string,
    deleteTime: number = 10000
): Promise<Message> => {
    const mess = await channel.send(message);
    setTimeout(() => {
        mess.delete();
    }, 10000);
    return mess;
};

const player = new Player(client, {
    leaveOnEmpty: true,
    leaveOnEnd: false,
    leaveOnStop: false,
    ytdlCookie: process.env.YOUTUBE_COOKIE,
});
const nowPlayingEmbed = (guildId: string) => {
    const queue = player.getQueue(guildId);
    const current = queue && queue.songs.length > 0 ? queue.songs[0] : null;

    const embed = new MessageEmbed()
        .setColor("#FF0000")
        .setTitle(
            current !== null
                ? current.name.replace("|", "\\|")
                : "Nothing playing"
        )
        .setURL(current !== null ? current.url : "")
        .setThumbnail(current !== null ? current.thumbnail : "")
        .addFields({
            name: "Artist",
            value: current !== null ? current.author : "",
        });

    try {
        const progressBar = queue.createProgressBar();
        embed.setDescription("`" + progressBar.prettier + "`");
    } catch {
        embed.setDescription("Nothing playing...");
    }
    return embed;
};
player.on("songFirst", (queue, song) => {
    client.user?.setActivity({
        name: song.name,
        type: "LISTENING",
    });
});

player.on("songChanged", (queue, song, old) => {
    client.user?.setActivity({
        name: song.name,
        type: "LISTENING",
    });
});

player.on("queueEnd", (queue) => {
    client.user?.setActivity({
        name: "Nothing",
        type: "LISTENING",
    });
});

client.on("messageCreate", async (message) => {
    const args = message.content.slice("!".length).trim().split(/ +/g);
    const command = args.shift();
    let guildQueue = player.getQueue(message.guild.id);

    if (command === "play") {
        let queue = player.createQueue(message.guild.id);
        await queue.join(message.member.voice.channel);
        let song = await queue.play(args.join(" ")).catch((_) => {
            if (!guildQueue) queue.stop();
        });
        if (song) {
            sendDelete(message.channel, `Added **${song.name}** to the queue`);
        }
    }

    if (command === "playlist") {
        let queue = player.createQueue(message.guild.id);
        await queue.join(message.member.voice.channel);
        let song = await queue.playlist(args.join(" ")).catch((_) => {
            if (!guildQueue) queue.stop();
        });
    }

    if (command === "skip") {
        guildQueue.skip();
        sendDelete(
            message.channel,
            `Now playing: **${guildQueue.nowPlaying}**`
        );
    }

    if (command === "stop") {
        if (guildQueue.songs.length > 0) {
            guildQueue.stop();
        }
        sendDelete(message.channel, "Stopping.");
    }

    if (command === "removeLoop") {
        guildQueue.setRepeatMode(RepeatMode.DISABLED); // or 0 instead of RepeatMode.DISABLED
    }

    if (command === "toggleLoop") {
        guildQueue.setRepeatMode(RepeatMode.SONG); // or 1 instead of RepeatMode.SONG
    }

    if (command === "toggleQueueLoop") {
        guildQueue.setRepeatMode(RepeatMode.QUEUE); // or 2 instead of RepeatMode.QUEUE
    }

    if (command === "setVolume") {
        guildQueue.setVolume(parseInt(args[0]));
    }

    if (command === "seek") {
        guildQueue.seek(parseInt(args[0]) * 1000);
    }

    if (command === "clearQueue") {
        guildQueue.clearQueue();
    }

    if (command === "shuffle") {
        guildQueue.shuffle();
    }

    if (command === "simvibes") {
        if (
            guildQueue !== undefined &&
            guildQueue.songs !== undefined &&
            guildQueue.songs.length > 0
        ) {
            guildQueue.stop();
        }

        const voiceChannel =
            message instanceof Message && message.member instanceof GuildMember
                ? message.member.voice.channel
                : null;

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        const stream = createAudioResource(
            "https://stream.simulatorvibes.com/radio/8000/radio"
        );
        const audioPlayer = createAudioPlayer({});

        audioPlayer.play(stream);
        audioPlayer.on("stateChange", (newState) => {
            console.log("Changing State: " + newState.status);
            if (
                newState.status !== AudioPlayerStatus.Buffering &&
                newState.status !== AudioPlayerStatus.Idle
            ) {
                audioPlayer.stop();
                audioPlayer.play(stream);
            }
        });

        audioPlayer.on("error", (err) => {
            console.error(JSON.stringify(err));
        });
        const subscription = connection.subscribe(audioPlayer);
        await message.reply("Now playing SimulatorVibes");
        client.user?.setActivity({
            name: "SimulatorVibes",
            type: "LISTENING",
        });
    }

    if (command === "nowPlaying") {
        if (nowPlayingUnsub) clearInterval(nowPlayingUnsub);
        latestNowPlaying = await message.channel.send({
            embeds: [nowPlayingEmbed(message.guild.id)],
        });
        nowPlayingUnsub = setInterval(() => {
            // let guildQueue = player.getQueue(message.guild.id);
            // try {
            //     const progressBar = guildQueue.createProgressBar();
            //     latestNowPlaying.edit(
            //         `Now playing: **${guildQueue.nowPlaying}**\n\`` +
            //             progressBar.prettier +
            //             "`"
            //     );
            // } catch {
            //     latestNowPlaying.edit(
            //         `Now playing: **${guildQueue.nowPlaying}**`
            //     );
            // }
            latestNowPlaying.edit({
                embeds: [nowPlayingEmbed(message.guild.id)],
            });
        }, 5000);
    }

    if (command === "pause") {
        guildQueue.setPaused(true);
    }

    if (command === "resume") {
        guildQueue.setPaused(false);
    }

    if (command === "remove") {
        guildQueue.remove(parseInt(args[0]));
    }

    if (command === "createProgressBar") {
        const ProgressBar = guildQueue.createProgressBar();

        // [======>              ][00:35/2:20]
        console.log(ProgressBar.prettier);
    }

    if (command === "queue") {
        const queue = player.getQueue(message.guild.id);
        if (queue) {
            const songs = queue.songs;
            let songList = "```\n";
            for (let i = 0; i < songs.length; i++) {
                songList += `${i + 1}. ${songs[i].name}\n`;
            }
            songList += "```";
            sendDelete(message.channel, songList, 60000);
        }
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
    return new Promise(async (resolve, reject) => {
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
                    // } else {
                    //     const twitchChannel = await getTwitchChannelFromUser(
                    //         member.user.id
                    //     );
                    //     return await isChannelLive(twitchChannel);
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

    channel.permissionOverwrites.create("900576907496661044", {
        CONNECT: false,
    });
    channel.permissionOverwrites.create("847215351237836860", {
        CONNECT: false,
    });

    const newData = await prisma.channel.upsert({
        where: { channelId: channel.id },
        create: {
            channelId: channel.id,
            name: channel.name,
            guildId: channel.guild.id,
            live: true,
        },
        update: { live: true, name: channel.name }, // Update channel name and live state
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

    channel.permissionOverwrites.edit("900576907496661044", { CONNECT: null });
    channel.permissionOverwrites.edit("847215351237836860", { CONNECT: null });

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
