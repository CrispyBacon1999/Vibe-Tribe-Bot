import {
    CommandInteraction,
    Guild,
    GuildMember,
    Interaction,
    Message,
    TextChannel,
} from "discord.js";
import {
    AudioPlayer,
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    joinVoiceChannel,
    NoSubscriberBehavior,
    VoiceConnection,
    VoiceConnectionStatus,
} from "@discordjs/voice";
import ytdl from "ytdl-core";

const queue = new Map<string, QueueContract>();

type QueueContract = {
    textChannel: TextChannel;
    voiceChannel: string;
    connection: VoiceConnection;
    songs: Song[];
    volume: number;
    playing: boolean;
    player: AudioPlayer;
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
        return message.reply(
            "You need to be in a voice channel to play music!"
        );
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK"))
        return message.reply(
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
            textChannel: message.channel as TextChannel,
            voiceChannel: voiceChannel.id,
            connection: null,
            songs: [],
            volume: 5,
            playing: true,
            player: null,
        };

        queue.set(message.guild.id, queueContract);
        queueContract.songs.push(song);

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Pause,
                },
            });
            connection.subscribe(player);
            queueContract.player = player;
            queueContract.connection = connection;
            connection.once("stateChange", (oldState, newState) => {
                if (newState.status === VoiceConnectionStatus.Ready) {
                    playSong(message.guild, queueContract.songs[0]);
                }
            });
        } catch (error) {
            console.error(error);
            queue.delete(message.guild.id);
            return message.reply(
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
        serverQueue.connection.destroy();
        queue.delete(guild.id);
        return;
    }

    const resource = createAudioResource(ytdl(song.url));

    const dispatcher = serverQueue.player
        // .play(ytdl(song.url, { filter: "audioonly" }))
        .play(resource);
    serverQueue.player.on("stateChange", (oldState, newState) => {
        if (
            oldState.status === AudioPlayerStatus.Playing &&
            newState.status === AudioPlayerStatus.Idle
        ) {
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        }
    });

    // dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
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
    serverQueue.songs.shift();
    playSong(message.guild, serverQueue.songs[0]);
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
    serverQueue.player.stop();
    serverQueue.connection.destroy();
}
