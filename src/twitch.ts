import { PrismaClient } from "@prisma/client";
import axios from "axios";
type AppTokenData = {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    expires_at?: number;
    scope?: string[];
    token_type?: string;
};
let appToken: AppTokenData = {};

const twitchAccessTokenUrl = "https://id.twitch.tv/oauth2/token";
const twitchStreamsUrl = "https://api.twitch.tv/helix/streams";
const clientId: string = process.env.TWITCH_CLIENT_ID as string;
const clientSecret: string = process.env.TWITCH_CLIENT_SECRET as string;

const refresh_buffer = 60;

const prisma = new PrismaClient();

export const getAccessToken = async (): Promise<string> => {
    if (
        appToken.expires_at &&
        appToken.expires_at < Date.now() - refresh_buffer
    ) {
        return appToken.access_token;
    } else {
        appToken = await generateAccessToken();
        return appToken.access_token;
    }
};

const generateAccessToken = async (): Promise<AppTokenData> => {
    const twitchResponse = await axios.get(
        twitchAccessTokenUrl +
            `?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
    );

    const newToken: AppTokenData = twitchResponse.data;
    newToken.expires_at = Date.now() + newToken.expires_in * 1000;
    return newToken;
};

export const isChannelLive = async (channelName: string): Promise<boolean> => {
    const token = await getAccessToken();
    const channelResponse = (
        await axios.get(twitchStreamsUrl + `user_login=${channelName}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
    ).data as any;
    console.log(channelResponse);
    return channelResponse.type === "live";
};

export const getTwitchChannelFromUser = async (
    userId: string
): Promise<string> => {
    const streamer = await prisma.streamer.findFirst({
        where: { streamerId: userId },
    });
    return streamer?.twitchName;
};
