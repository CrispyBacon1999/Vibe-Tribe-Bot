const { SlashCommandBuilder } = require("@discordjs/builders");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");

const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

const commands = [
  new SlashCommandBuilder()
    .setName("live")
    .setDescription("Toggle live state of current channel."),
].map((command) => command.toJSON());

const rest = new REST({ version: "9" }).setToken(BOT_TOKEN);

async () => {
  try {
    await rest.captureRejectionSymbol(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Successfully registered application commands.");
  } catch (error) {
    console.error(error);
  }
};
