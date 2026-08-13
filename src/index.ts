import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from "discord.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { handleButton } from "./handlers/components.js";
import { handleCommand } from "./handlers/commands.js";
import { handleDateApplicationModal, handleModal } from "./handlers/modals.js";
import { handlePanelModal, handlePanelSelect, handlePanelUserSelect } from "./handlers/panel.js";
import { startMaintenance } from "./jobs.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function reportError(interaction: Interaction, error: unknown) {
  console.error(error);
  const content = `操作失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
  if (!interaction.isRepliable()) return;
  try {
    if (interaction.deferred) await interaction.editReply(content);
    else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch (responseError) {
    console.error("無法回覆錯誤訊息", responseError);
  }
}

client.once(Events.ClientReady, ready => {
  console.log(`已登入 ${ready.user.tag}，服務 ${ready.guilds.cache.size} 個伺服器。`);
  startMaintenance(ready);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isStringSelectMenu()) await handlePanelSelect(interaction);
    else if (interaction.isUserSelectMenu()) await handlePanelUserSelect(interaction);
    else if (interaction.isModalSubmit()) {
      if (await handlePanelModal(interaction)) return;
      if (interaction.customId.startsWith("date_application:")) {
        const id = interaction.customId.slice("date_application:".length);
        await handleDateApplicationModal(interaction, id);
      } else await handleModal(interaction);
    }
  } catch (error) {
    await reportError(interaction, error);
  }
});

async function shutdown(signal: string) {
  console.log(`收到 ${signal}，正在關閉。`);
  client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", error => console.error("未處理的非同步錯誤", error));

await client.login(config.DISCORD_TOKEN);
