import Discord, { Client, Message } from "discord.js";
import type { DataBaseClient } from "./database.js";
import { assertUnreachable } from "./types.js";

import { add } from "./services/add.js";
import { remove } from "./services/remove.js";
import { update } from "./services/update.js";
import { register } from "./services/register.js";
import { list } from "./services/list.js";
import { history } from "./services/history.js";
import { productUpdatesString, splitMessageSend, string2int } from "./utils.js";

type Params = {
  token: string;
  databaseClient: DataBaseClient;
};

export function startClient({ token, databaseClient }: Params) {
  const client = new Discord.Client({
    intents: ["Guilds", "GuildMessages", "MessageContent"],
  });

  // Add events to client
  client.on("ready", () => {
    console.log(
      `Logged in as: ${client.user.username}, use /help to view commands.`
    );
  });

  client.on("messageCreate", (message) => {
    if (message.author.id != client.user.id) {
      if (
        message.content.length > 0 &&
        message.content.startsWith("/") &&
        message.channelId === process.env["DISCORD_CHANNEL_ID"]
      ) {
        handleCommand(client, message, databaseClient);
      }
    }
  });

  client.login(token);
  return client;
}

export async function getChannel(discordClient: Client) {
  return await discordClient.channels.fetch(process.env["DISCORD_CHANNEL_ID"]);
}

const commands = {
  "/help": "view this output",
  "/register": "create account to track products",
  "/add {name}, {url}": "add product to track, notice the comma",
  "/remove {name}": "remove product from tracking",
  "/update": "manually update product prices",
  "/list": "list tracked products",
  "/history {name}": "view price history of the product",
};

async function handleCommand(
  discordClient: Client,
  message: Message,
  databaseClient: DataBaseClient
) {
  const [command, params] = parseMessage(message.content);

  const func = {
    "/help": () => {
      const commandsString = Object.keys(commands)
        .map((key) => `${key} - ${commands[key]}`)
        .join("\n");
      message.channel.send(
        `Welcome, the available commands are as follows:\n\n${commandsString}`
      );
    },
    "/register": async () => {
      const result = await register({
        databaseClient,
        discordId: message.author.id,
        discordName: message.author.username,
      });

      switch (result.status) {
        case "success":
          message.channel.send(
            `Created new user, hi ${message.author.username}!`
          );
          break;
        case "duplicate":
          message.channel.send(
            `You are already registered, ${message.author.username}.`
          );
          break;
        case "error":
          message.channel.send(`Something went wrong: ${result.error}`);
          break;
        default:
          assertUnreachable(result.status);
      }
    },
    "/add": async () => {
      const result = await add({
        databaseClient,
        discordClient,
        discordId: message.author.id,
        name: params[0],
        url: params[1],
      });

      switch (result.status) {
        case "success":
          message.channel.send(`Tracking ${params[0]}!`);
          break;
        case "not_registered":
          message.channel.send(`You need to /register to add products.`);
          break;
        case "product_exists":
          message.channel.send(`You are already tracking this product.`);
          break;
        case "name_missing":
          message.channel.send(
            "You need to provide a name for the product: /add {name}, {url}"
          );
          break;
        case "url_missing":
          message.channel.send(
            "You need to provide a url for the product: /add {name}, {url}"
          );
          break;
        case "unable_to_scrape":
          message.channel.send(
            "Product not tracked, because I am unable to scrape the price."
          );
          break;
        case "error":
          message.channel.send(`Something went wrong: ${result.error}`);
          break;
        default:
          assertUnreachable(result.status);
      }
    },
    "/remove": async () => {
      const result = await remove({
        databaseClient: databaseClient,
        name: params[0],
        discordId: message.author.id,
      });

      switch (result.status) {
        case "success":
          message.channel.send(`No longer tracking ${params[0]}.`);
          break;
        case "not_registered":
          message.channel.send(
            `You need to /register and track something to remove products.`
          );
          break;
        case "product_not_found":
          message.channel.send(`This product is not being tracked.`);
          break;
        case "name_missing":
          message.channel.send(
            "You need to provide a name for the product: /remove {name}"
          );
          break;
        case "error":
          message.channel.send(`Something went wrong: ${result.error}`);
          break;
        default:
          assertUnreachable(result.status);
      }
    },
    "/update": async () => {
      try {
        const result = await update({
          databaseClient,
          discordClient,
          discordId: message.author.id,
        });

        switch (result.status) {
          case "success":
            if (result.amount && result.amount > 0) {
              if (result.changed.length > 0) {
                // Price updates
                const productUpdateString = productUpdatesString(
                  result.changed
                );
                const updateString = `Some of your tracked products' prices changed:\n${productUpdateString}`;
                await splitMessageSend(updateString, message.channel);
              } else {
                message.channel.send("Product prices checked, no updates.");
              }
            } else {
              message.channel.send("You aren't tracking any products.");
            }
            break;
          case "not_registered":
            message.channel.send(
              `You need to /register and track something to update product prices.`
            );
            break;
          case "error":
            message.channel.send(`Something went wrong: ${result.error}`);
            break;
          default:
            assertUnreachable(result.status);
        }
      } catch (error) {
        message.channel.send(`Something went wrong: ${error}`);
      }
    },
    "/list": async () => {
      const result = await list({
        databaseClient: databaseClient,
        discordId: message.author.id,
      });

      switch (result.status) {
        case "success":
          if (result.products.length > 0) {
            const productsString = result.products
              .map(
                (product) =>
                  `${product.name}, ${product.price}, <${product.url}>`
              )
              .join("\n");
            await splitMessageSend(
              `Your tracked products:\n${productsString}`,
              message.channel
            );
          } else {
            message.channel.send("You aren't tracking any products!");
          }
          break;
        case "not_registered":
          message.channel.send(
            "You need to /register and track something to list products."
          );
          break;
        case "error":
          message.channel.send(`Something went wrong: ${result.error}`);
          break;
        default:
          assertUnreachable(result.status);
      }
    },
    "/history": async () => {
      const result = await history({
        databaseClient,
        discordId: message.author.id,
        name: params[0],
      });

      switch (result.status) {
        case "success":
          const historyStringArray = [];
          let previousPrice = 0;
          for (let i = 0; i < result.product.pricePoints.length; i++) {
            const pricePoint = result.product.pricePoints[i];
            const thisPrice = string2int(pricePoint.price);

            if (i === 0) {
              historyStringArray.push(
                `${result.product.name} has the following price history (${result.product.pricePoints.length} datapoints):`
              );
              historyStringArray.push(`(Current price): ${pricePoint.price}`);
            } else if (thisPrice !== previousPrice) {
              historyStringArray.push("...");
              historyStringArray.push(
                `(${pricePoint.createdAt}): ${pricePoint.price}`
              );
            }

            previousPrice = string2int(pricePoint.price);
          }
          await splitMessageSend(
            historyStringArray.join("\n"),
            message.channel
          );
          break;
        case "name_missing":
          message.channel.send(
            "You need to provide a name for the product: /history {name}"
          );
          break;
        case "name_wrong":
          message.channel.send(
            `You are not tracking a product with the name: ${params[0]}`
          );
          break;
        case "not_registered":
          message.channel.send(
            "You need to /register and track products to view history."
          );
          break;
        case "error":
          message.channel.send(`Something went wrong: ${result.error}`);
          break;
        default:
          assertUnreachable(result.status);
      }
    },
  }[command];

  // execute function
  if (func) {
    func();
  } else {
    console.error(`Command not found ${command}`);
  }
}

function parseMessage(message: string): [string, string | string[]] {
  const [command, ...rest] = message.split(" ");
  const tempParams = rest.join(" ").split(",");
  const params = tempParams.map((param) => param.trim());
  return [command, params];
}
