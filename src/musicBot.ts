import {
    CommandInteraction,
    Guild,
    GuildMember,
    Interaction,
    Message,
} from "discord.js";
import { joinVoiceChannel, VoiceConnection } from "@discordjs/voice";
import * as ytdl from "ytdl-core";

const queue = new Map();

type QueueContract = {
    textChannel: string;
    voiceChannel: string;
    connection: VoiceConnection;
    songs: Song[];
    volume: number;
    playing: boolean;
};

type Song = {
    title: string;
    url: string;
};

export async function play(message: Message | CommandInteraction) {
    let args = null;
    if (message instanceof Message) {
        const argsSplit = message.content.trim().split(" ");
        args = argsSplit.slice(1).join(" ");
    } else {
        args = message.options.get("song")!.value! as string;
    }
    const voiceChannel =
        message instanceof CommandInteraction &&
        message.member instanceof GuildMember
            ? message.member.voice.channel
            : null;

    if (!voiceChannel)
        return message.channel.send(
            "You need to be in a voice channel to play music!"
        );
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK"))
        return message.channel.send(
            "I need the permissions to join and speak in your voice channel!"
        );

    const songInfo = await ytdl.getInfo(args);
    const song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
    };

    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue) {
        const queueContract: QueueContract = {
            textChannel: message.channel.id,
            voiceChannel: voiceChannel.id,
            connection: null,
            songs: [],
            volume: 5,
            playing: true,
        };

        queue.set(message.guild.id, queueContract);
        queueContract.songs.push(song);

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });
            queueContract.connection = connection;
            playSong(message.guild, queueContract.songs[0]);
        } catch (error) {
            console.error(error);
            queue.delete(message.guild.id);
            return message.channel.send(
                "I could not join the voice channel! Make sure I have the proper permissions!"
            );
        }
    } else {
        serverQueue.songs.push(song);
        console.log(serverQueue.songs);
        return message.channel.send(
            `**${song.title}** has been added to the queue.`
        );
    }
}

async function playSong(guild: Guild, song: Song) {
    const serverQueue = queue.get(guild.id);

    if (!song) {
        serverQueue.voiceChannel.leave();
        queue.delete(guild.id);
        return;
    }

    const dispatcher = serverQueue.connection
        .play(ytdl(song.url, { filter: "audioonly" }))
        .on("finish", () => {
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        })
        .on("error", (error) => console.error(error));
    dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
    serverQueue.textChannel.send(`Now playing: **${song.title}**`);
}

export async function skip(message: Message | CommandInteraction) {
    const serverQueue = queue.get(message.guild.id);
    if (
        message.member instanceof GuildMember &&
        !message.member.voice.channel
    ) {
        return message.channel.send(
            "You need to be in a voice channel to skip music!"
        );
    }
    if (!serverQueue) return message.channel.send("There is no song to skip");
    serverQueue.connection.dispatcher.end();
}

export async function stop(message: Message | CommandInteraction) {
    const serverQueue = queue.get(message.guild.id);
    if (
        message.member instanceof GuildMember &&
        !message.member.voice.channel
    ) {
        return message.channel.send(
            "You need to be in a voice channel to stop music!"
        );
    }
    if (!serverQueue) return message.channel.send("There are no songs to stop");

    serverQueue.songs = [];
    serverQueue.connection.dispatcher.end();
}
