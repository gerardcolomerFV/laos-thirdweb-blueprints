// Load the environment variables from the .env file
import dotenv from "dotenv";
dotenv.config();

import { registerBridgelessMintingEndpoint } from "./endpoints/bridgelessMinting.js";
import { registerUsdtTransfersEndpoint } from "./endpoints/usdtTransfers.js";
// Import necessary modules
import { Access } from "./lib/access/index.js";

const access = new Access();

// Register the USDT Transfers endpoint
registerUsdtTransfersEndpoint(access);

// Register the Bridgeless Minting endpoint
registerBridgelessMintingEndpoint(access);

// ----------------- Start the server -------------------
access.start();
